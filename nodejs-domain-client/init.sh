#!/bin/sh -ex
rm -rf app-suite
starcp --stardust-base wss://stardust.apt.danopia.net/~~export/ws --src sd:/n/redis-ns/app-suite --dest app-suite
echo Done getting app-suite
