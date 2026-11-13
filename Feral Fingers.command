#!/bin/bash
cd "$(dirname "$0")" || exit 1
ROOT="$PWD"
PYTHON="$ROOT/.venv/bin/python"
DASHBOARD="$ROOT/experiments/five-imu-dashboard/server.py"
ROUTER="$ROOT/experiments/five-voice-midi/router.py"
START="$ROOT/scripts/start-harmonic-explorer.sh"
STATE="$HOME/Library/Caches/Feral Fingers"
URL="http://127.0.0.1:8767/harmonic-explorer"

listener() { /usr/sbin/lsof -nP -tiTCP:"$1" -sTCP:LISTEN; }
is_service() {
  local command
  command=$(/bin/ps -p "$1" -o command= 2>/dev/null)
  case "$command" in *"$2"*) return 0;; *) return 1;; esac
}
service_state() {
  local pid
  pid=$(listener "$1")
  if [ -z "$pid" ]; then echo STOPPED; return; fi
  case "$pid" in *$'\n'*) echo 'PORT IN USE'; return;; esac
  if ! is_service "$pid" "$2"; then echo 'PORT IN USE'; return; fi
  if /usr/bin/curl -fsS --max-time 1 "http://127.0.0.1:$1/status" >/dev/null 2>&1; then echo RUNNING; else echo 'NOT RESPONDING'; fi
}
show_status() {
  local bridge router bridge_json router_json sensor_line midi_line
  bridge=$(service_state 8766 "$DASHBOARD")
  router=$(service_state 8767 "$ROUTER")
  sensor_line='Unknown (router unavailable)'; midi_line='Unknown (router unavailable)'
  if [ "$bridge" = RUNNING ]; then
    bridge_json=$(/usr/bin/curl -fsS --max-time 1 http://127.0.0.1:8766/status 2>/dev/null)
    sensor_line=$(printf '%s' "$bridge_json" | "$PYTHON" -c 'import json,sys; d=json.load(sys.stdin); age=d.get("age"); print("Bridge connected" if d.get("state")=="connected" and age is not None and age<1.5 else "No fresh bridge data ("+str(d.get("message") or d.get("state") or "unknown")+")")' 2>/dev/null || echo 'Bridge status unavailable')
  fi
  if [ "$router" = RUNNING ]; then
    router_json=$(/usr/bin/curl -fsS --max-time 1 http://127.0.0.1:8767/status 2>/dev/null)
    midi_line=$(printf '%s' "$router_json" | "$PYTHON" -c 'import json,sys; print("Ready" if json.load(sys.stdin).get("output_available") else "Unavailable")' 2>/dev/null || echo Unknown)
    if [ "$bridge" = RUNNING ]; then
      sensor_line=$(printf '%s' "$router_json" | "$PYTHON" -c 'import json,sys; d=json.load(sys.stdin); f=d.get("sensor_fresh"); print(str(sum(bool(x) for x in f))+"/5 fresh" if isinstance(f,list) and len(f)==5 else "Unknown")' 2>/dev/null || echo Unknown)
    else sensor_line='No bridge data'; fi
  fi
  printf '\n================================\n       FERAL FINGERS\n================================\n\n'
  printf '%-17s %s\n' 'Sensor bridge:' "$bridge" 'MIDI router:' "$router" 'Sensors:' "$sensor_line" 'MIDI output:' "$midi_line"
}
start_services() {
  if [ ! -x "$START" ]; then echo 'The Harmonic Explorer launcher is missing or not executable.'; return 1; fi
  echo 'Starting services…'
  FF_SERVICES_ONLY=1 "$START" || { echo 'Start failed; check the messages above and the service logs.'; return 1; }
  echo 'Start complete.'
}
stop_service() {
  local name="$1" port="$2" script="$3" pid job next label
  pid=$(listener "$port")
  if [ -z "$pid" ]; then
    if [ "$name" = 'MIDI router' ]; then label=com.feralfingers.control.router; else label=com.feralfingers.control.dashboard; fi
    job=$(/bin/launchctl list "$label" 2>/dev/null)
    if [ -n "$job" ]; then
      if ! printf '%s\n' "$job" | /usr/bin/grep -Fq "$script"; then echo "$name: unexpected supervised job; left untouched."; return 1; fi
      /bin/launchctl remove "$label" || { echo "$name: could not remove its stopped service."; return 1; }
    fi
    echo "$name: already stopped."; return 0
  fi
  case "$pid" in *$'\n'*) echo "$name: multiple listeners on port $port; left untouched."; return 1;; esac
  if ! is_service "$pid" "$script"; then echo "$name: port $port belongs to another process; left untouched."; return 1; fi
  if [ "$name" = 'MIDI router' ]; then
    /usr/bin/curl -fsS --max-time 2 -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8767/stop >/dev/null 2>&1 || echo 'Router did not acknowledge note release; requesting graceful shutdown.'
  fi
  for label in com.feralfingers.router.manual com.feralfingers.control.router com.feralfingers.control.dashboard; do
    job=$(/bin/launchctl list "$label" 2>/dev/null)
    if printf '%s\n' "$job" | /usr/bin/grep -Fq "$script" && printf '%s\n' "$job" | /usr/bin/grep -Eq '"PID" = '"$pid"';'; then
      /bin/launchctl remove "$label" || { echo "$name: could not stop its supervised service."; return 1; }
    fi
  done
  if kill -0 "$pid" 2>/dev/null && is_service "$pid" "$script"; then kill -TERM "$pid" 2>/dev/null || { echo "$name: could not stop."; return 1; }; fi
  for i in {1..75}; do
    next=$(listener "$port")
    if [ -z "$next" ]; then
      rm -f "$STATE/$([ "$name" = 'MIDI router' ] && echo router || echo dashboard).pid"
      echo "$name: stopped."; return 0
    fi
    if [ "$next" != "$pid" ]; then echo "$name: port $port was taken or the service restarted; left untouched."; return 1; fi
    sleep .2
  done
  echo "$name: still running or stopping; check the service log."
  return 1
}
stop_services() {
  local result=0
  stop_service 'MIDI router' 8767 "$ROUTER" || result=1
  stop_service 'Sensor bridge' 8766 "$DASHBOARD" || result=1
  return "$result"
}
open_explorer() {
  if [ "$(service_state 8767 "$ROUTER")" != RUNNING ]; then echo 'The MIDI router is not running. Choose 1 to start it first.'; return 1; fi
  if ! /usr/bin/osascript -e 'id of application "Google Chrome"' >/dev/null 2>&1; then echo 'Google Chrome could not be found. Install Chrome to open the Explorer.'; return 1; fi
  /usr/bin/open -a "Google Chrome" "$URL" || { echo 'Google Chrome could not open Harmonic Explorer.'; return 1; }
}
open_sensor_graphs() {
  if [ "$(service_state 8766 "$DASHBOARD")" != RUNNING ]; then echo 'The sensor bridge is not running. Choose 1 to start it first.'; return 1; fi
  if ! /usr/bin/osascript -e 'id of application "Google Chrome"' >/dev/null 2>&1; then echo 'Google Chrome could not be found. Install Chrome to open the sensor graphs.'; return 1; fi
  /usr/bin/open -a "Google Chrome" 'http://127.0.0.1:8766/' || { echo 'Google Chrome could not open the sensor graphs.'; return 1; }
}
while true; do
  show_status
  printf '\n--------------------------------\n1. Start\n2. Stop\n3. Restart\n4. Open Harmonic Explorer\n5. Open Sensor Time Graphs\n6. Refresh status\n0. Exit\n--------------------------------\n\nChoose: '
  IFS= read -r choice || { printf '\n'; break; }
  case "$choice" in
    1) start_services ;;
    2) stop_services ;;
    3) if stop_services; then start_services; else echo 'Restart stopped because a service could not be stopped safely.'; fi ;;
    4) open_explorer ;;
    5) open_sensor_graphs ;;
    6) ;;
    0) break ;;
    *) echo 'Please choose 0–5.' ;;
  esac
done
