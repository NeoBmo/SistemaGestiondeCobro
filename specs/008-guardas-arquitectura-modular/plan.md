# Plan — 008 Guardas de arquitectura modular

1. Registrar el baseline observado de dependencias permitidas entre módulos.
2. Crear el checker de imports/grafo usando el TypeScript local, sin dependencias nuevas.
3. Romper el ciclo de tipos identity/audit con un tipo estructural de actor en el módulo audit.
4. Añadir script npm y ejecución en job `quality`.
5. Documentar la dirección de dependencias y el control automático en 03.
6. Ejecutar el guard, typecheck y diff check; registrar limitaciones.
