#!/bin/bash
# Entrypoint for the TinyMUSH game container.
# Runs netmush with --debug to prevent double-forking so Docker manages
# the process as PID 1.  Any arguments passed to the container are forwarded.
set -e
cd /game
exec ./netmush --debug "${@}"
