# Backup y restauración

> Decisión: `docs/planning/03-ARQUITECTURA.md` §7. Supabase Free **no** incluye backups recuperables, así que hay un backup lógico diario propio, cifrado, con retención de 30 días. Un backup no está validado hasta que se ha restaurado: el **ensayo de restauración** es condición de salida de F8.

## Cómo funciona

`.github/workflows/backup.yml` corre a diario (03:17 hora de Bogotá) y también a mano desde *Actions → Backup diario cifrado → Run workflow*. En cada ejecución:

1. Exporta con `supabase db dump` tres archivos: `roles.sql` (`--role-only`), `schema.sql` (esquema) y `data.sql` (`--data-only --use-copy`).
2. Los empaqueta en un `tar.gz` que pasa por tubería directamente a `age`, cifrado con la **clave pública** del dueño. No queda un paquete en claro en disco.
3. Borra los `.sql` en claro y sube **solo** el archivo `cuadre-backup-<fecha>.tar.gz.age` como artefacto `backup-<run_id>`, con `retention-days: 30`.

### Por qué cifrado de clave pública

El repositorio es **público**: cualquier persona con cuenta de GitHub puede descargar los artefactos de sus workflows. Por eso el artefacto debe ser ilegible sin una clave que GitHub nunca tenga.

Con `age` la CI solo conoce la clave pública (`age1…`), que sirve para **cifrar** pero no para descifrar. La clave privada (`AGE-SECRET-KEY-1…`) vive solo con el dueño. Aunque alguien robe el artefacto, o incluso los secretos del repositorio, no puede leer el backup. Con una contraseña simétrica guardada como secreto, en cambio, quien obtuviera ese secreto podría descifrarlo todo.

## Configuración inicial (la hace el dueño, una vez)

### 1. Generar el par de claves `age`

En **tu** equipo, nunca en la CI ni en el repositorio:

```sh
# Windows: winget install --id FiloSottile.age   ·   macOS: brew install age   ·   Debian/Ubuntu: apt install age
age-keygen -o cuadre-backup.key
```

- `cuadre-backup.key` contiene la **clave privada**. Guárdala en tu gestor de contraseñas y en una segunda copia offline (USB cifrada, papel en lugar seguro). **Si se pierde, ningún backup se puede recuperar.**
- El comando imprime la clave pública (`Public key: age1…`). También puedes obtenerla con `age-keygen -y cuadre-backup.key`.
- **Nunca** commitees `cuadre-backup.key` ni la pegues en un issue, PR, secreto o variable.

### 2. Configurar GitHub

En *Settings → Secrets and variables → Actions* del repositorio:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| **Secret** | `SUPABASE_DB_URL` | Cadena de conexión del proyecto de producción, modo **Session pooler** (Supabase → *Connect*). Ejemplo de forma: `postgresql://postgres.<ref>:<contraseña>@aws-0-<región>.pooler.supabase.com:5432/postgres`. La contraseña va codificada en porcentaje si tiene caracteres especiales. |
| **Variable** | `BACKUP_AGE_RECIPIENT` | La clave **pública** `age1…`. No es secreta; va como variable para poder verla y rotarla. |

Usa el **Session pooler** y no la conexión directa: la conexión directa de Supabase es solo IPv6 y los runners de GitHub no tienen IPv6.

Si falta cualquiera de los dos, el job falla con un mensaje que lo nombra; nunca termina en verde sin backup.

### 3. Primera ejecución

1. *Actions → Backup diario cifrado → Run workflow* (rama `main`).
2. Comprueba que el job termina en verde, que el log solo muestra tamaños de archivo y que el artefacto `backup-<run_id>` contiene un único `.tar.gz.age`.
3. Descárgalo y descífralo (sección siguiente) para confirmar que tu clave privada lo abre.
4. Haz el ensayo de restauración completo (más abajo) antes de dar F8 por cerrada.

### Ojo: GitHub desactiva las tareas programadas

En repositorios públicos, GitHub **desactiva los workflows `schedule` tras 60 días sin actividad** en el repositorio. Si eso pasa, el backup deja de ejecutarse sin avisar. Revisa *Actions* al menos una vez al mes y, si aparece el aviso, reactívalo. El registro mensual de verificación (abajo) sirve también para detectarlo.

## Descargar y descifrar un backup

```sh
# 1. Descargar (requiere gh autenticado); o desde la pestaña Summary de la ejecución
gh run list --workflow backup.yml --limit 5
gh run download <run_id> --name backup-<run_id> --dir backup

# 2. Descifrar y desempaquetar (en un directorio que no esté dentro del repositorio)
age --decrypt --identity cuadre-backup.key backup/cuadre-backup-*.tar.gz.age | tar -xzf - -C backup
ls backup   # roles.sql  schema.sql  data.sql
```

Los `.sql` descifrados contienen **datos personales y financieros reales**. Trabaja fuera de la carpeta del repositorio, no los subas a ningún sitio y bórralos al terminar.

## Restaurar

Siempre en un proyecto Supabase **distinto** de producción salvo un desastre real. La secuencia sigue la que documenta Supabase para restaurar un dump de la CLI, con los roles en un paso aparte:

```sh
# 1. Roles. `--role-only` ya excluye los roles reservados de Supabase; va aparte para que un rol que ya
#    exista en el destino no aborte toda la restauración. Revisa cada ERROR que imprima.
psql --file backup/roles.sql --dbname "<cadena Session pooler del proyecto destino>"

# 2. Esquema y datos: todo o nada.
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file backup/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file backup/data.sql \
  --dbname "<cadena Session pooler del proyecto destino>"
```

- `--single-transaction` + `ON_ERROR_STOP`: esquema y datos se restauran enteros o no se restaura nada.
- `session_replication_role = replica` desactiva los triggers durante la carga de datos. Sin esto, los triggers de solo-agregado, de saldo no negativo y de calendario se ejecutarían sobre filas que ya fueron validadas en origen, y algunos fallarían por el orden de carga.
- Un `ERROR` en el paso 1 se investiga antes de seguir: en un proyecto nuevo no debería aparecer ninguno.

## Ensayo de restauración (condición de salida de F8)

Se repite **al menos una vez antes de lanzar** y después **cada trimestre**, o tras cualquier cambio en el workflow o en el esquema que afecte a dinero.

### Preparación

1. Crea un proyecto Supabase **nuevo y separado** (plan gratuito), p. ej. `cuadre-restore-ensayo`. Nunca uses el de producción.
2. Ejecuta el backup a mano y anota la hora UTC de inicio del job (`T`).
3. Descarga, descifra y restaura en el proyecto de ensayo como se describe arriba.
4. **Configura Auth en el proyecto de ensayo**: la configuración de Auth no viaja en el dump. En *Authentication → Hooks* activa el *Custom Access Token* con `private.custom_access_token_hook`, que añade `app_role` y `business_id` al JWT. Sin él, el login da sesiones sin rol ni negocio y el ensayo fallaría por una causa ajena al backup. Replica también el resto de ajustes de Auth de producción: URL del sitio, URLs de redirección y política de contraseñas.
5. Para ver la aplicación sobre la copia, arráncala en local con `.env.local` apuntando al proyecto de ensayo (sus `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` y `DATABASE_URL`), nunca a producción.

### Checklist de consistencia

Marca cada punto y guarda el resultado.

- [ ] **Restauración sin errores**: los dos pasos de `psql` terminaron sin `ERROR`.
- [ ] **Conteos por tabla**: los conteos de la copia coinciden con los de producción para filas creadas hasta `T`. En la copia:

  ```sql
  -- Todas las tablas de public, presentes y futuras, más los usuarios de Auth.
  select table_name::text as tabla,
         (xpath('/row/c/text()',
                query_to_xml(format('select count(*) as c from public.%I', table_name),
                             false, true, '')))[1]::text::bigint as filas
    from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'
  union all
  select 'auth.users', count(*) from auth.users
  order by 1;
  ```

  Ejecuta la misma consulta en producción justo antes de lanzar el backup del ensayo, fuera de la jornada de cobro para que no haya escrituras en curso. Si hubo actividad después de `T`, compara las tablas con `created_at` con `select count(*) from public.<tabla> where created_at <= '<T>'`.

- [ ] **Saldo de Caja Mayor = suma de movimientos**, por negocio. Un movimiento sin `session_id` es de la Caja Mayor:

  ```sql
  select business_id,
         sum(case direction when 'ENTRADA' then amount else -amount end) as saldo_caja_mayor
    from public.cash_movements
   where session_id is null
   group by business_id
   order by business_id;
  ```

  Comprueba tres cosas: ningún saldo es negativo; coincide con la misma consulta en producción filtrada por `created_at <= '<T>'`; y coincide con el saldo que muestra la pantalla de Caja Mayor de la aplicación apuntando a la copia, para al menos dos negocios.

- [ ] **Una jornada completa visible**: elige en la copia una jornada `LIQUIDADA` o `LIQUIDADA_CON_DIFERENCIA` reciente y comprueba en la aplicación que se ven su apertura, sus cobros y gastos, la declaración del cobrador y la liquidación con su diferencia, y que la auditoría muestra esos eventos.
- [ ] **Login**: un usuario `ADMIN_NEGOCIO` de prueba inicia sesión en la copia (las cuentas de `auth.users` se restauraron).
- [ ] **Inmutabilidad**: un `update` sobre `public.cash_movements` en la copia falla (los triggers de solo-agregado volvieron a quedar activos tras la carga).

### Registrar el resultado

1. Registra la verificación en el panel del Super Admin (*Backups*: fecha, `OK` o `FALLO` y una nota breve **sin datos personales**: p. ej. «Ensayo trimestral, 14 tablas cuadran, Caja Mayor cuadra en 3 negocios»).
2. **Elimina el proyecto de ensayo** en Supabase y borra los `.sql` descifrados de tu equipo: contienen datos reales.

## Rotar la clave

Si la clave privada se compromete o se pierde:

1. Genera un par nuevo y actualiza la variable `BACKUP_AGE_RECIPIENT`.
2. Ejecuta el backup a mano y verifica que la clave nueva lo abre.
3. Si la clave se **comprometió**, los artefactos de los últimos 30 días cifrados con la anterior siguen siendo legibles para quien la tenga: bórralos desde *Actions* una vez confirmado el primer backup nuevo.
4. Si se **perdió**, los backups anteriores son irrecuperables; el primero cifrado con la clave nueva es el punto de partida.
