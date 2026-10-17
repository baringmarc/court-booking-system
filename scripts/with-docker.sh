#!/bin/sh
# Runs a command with Docker Desktop reachable, even from non-login shells
# (IDE terminals, Claude Code hooks) where ~/.zprofile hasn't added it to PATH.
# Usage: sh scripts/with-docker.sh <command> [args...]

if ! command -v docker >/dev/null 2>&1 && [ -x "$HOME/.docker/bin/docker" ]; then
  PATH="$HOME/.docker/bin:$PATH"
  export PATH
fi

# Docker Desktop's per-user socket, used when the system socket doesn't exist.
if [ -z "$DOCKER_HOST" ] && [ ! -S /var/run/docker.sock ] && [ -S "$HOME/.docker/run/docker.sock" ]; then
  DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
  export DOCKER_HOST
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI not found. Install Docker Desktop: https://docs.docker.com/desktop/" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Start Docker Desktop and try again." >&2
  exit 1
fi

exec "$@"
