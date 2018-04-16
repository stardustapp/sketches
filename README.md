# Stardust Sketches

This repo is basically a dumping ground for random scripts and glue that holds stuff together.

In general stuff in this repo is 'temporary'. E.g. the functionality should eventually be expressed natively in Stardust. For now, sketches live and run outside the system and reach in generally only for data.

# Getting Dependencies

`nodejs-domain-client` bootstraps app-suite's in-browser Skylink orbiter. It needs the source of app-suite to do that. `init.sh` downloads the dependency from devmode.cloud's public endpoint using `starcp`. starcp is available from `go get -u stardustapp/core/utils/starcp`

In short...

```sh
go get -u stardustapp/core/utils/starcp
cd nodejs-domain-client
npm i
./init.sh
cd ..
```

That should be enough to support running the kubernetes architect, and whatever comes next
