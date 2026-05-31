#!/bin/bash

# Determine the type of build based on the first script argument
BUILD_TYPE=${1:-production}

if [ "$BUILD_TYPE" == "canary" ]; then
    TAG="canary"
else
    VERSION=$(node -p "require('./package.json').version")
    TAG="$VERSION"
fi

# The Dockerfile COPYs .env.production from the build context; CI synthesizes it,
# so create it here too for local builds.
if [ ! -f .env.production ]; then
    cp apps/dokploy/.env.production.example .env.production
fi

BUILDER=$(docker buildx create --use)

docker buildx build --platform linux/amd64,linux/arm64 --pull --rm -t "ghcr.io/ghaaf-labs/crane:${TAG}" -f 'Dockerfile' .

docker buildx rm $BUILDER
