#!/bin/sh
# Ephemeral local scheduler fixture only. Nothing is written or logged.
head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \n'
