# Feral Fingers

Feral Fingers is an open-source wearable musical instrument exploring expressive hand and finger control, sensors, synthesis, and haptic feedback.

This repository is a home for both experiments and longer-term development. The design will evolve through building, playing, and testing ideas.

## Control

On macOS, double-click `Feral Fingers.command` to start, stop or restart the sensor bridge and MIDI router, check their status, or open Harmonic Explorer in Google Chrome. The services keep running when you exit the menu. The existing project `.venv` must contain `pyserial` and `python-rtmidi`; enable IAC Driver Bus 1 in Audio MIDI Setup.
