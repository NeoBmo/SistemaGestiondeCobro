#!/usr/bin/env bash
# PreToolUse (Bash): bloquea `git commit` cuando la rama actual es main.
# Regla: 07-FLUJO-DE-TRABAJO.md §3 — rama por tarea, nunca directo a main.
input="$(cat)"
if echo "$input" | grep -Eq 'git[[:space:]]+commit'; then
  branch="$(git branch --show-current 2>/dev/null)"
  if [ "$branch" = "main" ]; then
    echo "Bloqueado: no se commitea en main. Crea una rama de tarea (git checkout -b <rama>)." >&2
    exit 2
  fi
fi
exit 0
