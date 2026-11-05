#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec "${BMI323_PYTHON:-python3}" server.py "$@"
