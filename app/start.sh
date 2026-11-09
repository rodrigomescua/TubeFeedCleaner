#!/bin/sh
set -eu
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
x11vnc -display :99 -localhost -forever -shared -nopw -quiet -loop &
websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 &
exec node /app/app/server.js
