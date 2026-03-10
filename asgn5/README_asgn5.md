# AI Usage

I used an LLM to help me code up this project. Most of the code is from a LLM which allowed me to code faster with the downside of frequently debugging it's output.
---
# Three.js Temple Relic Hunt (Assignment 5)

## Overview
This project is a **Three.js first-person exploration mini-game** where the player explores a temple arena, collects glowing relic orbs, and avoids a hostile drone. The scene demonstrates core Three.js features including lighting, textures, a skybox, a custom GLTF model, collision-based movement, and interactive gameplay systems.

The player uses a **first-person perspective camera with pointer-lock controls** to move through the environment, collect all 10 relic orbs, and survive the drone long enough to clear the temple.

---

## Controls

| Control | Action |
|------|------|
| Mouse | Look around |
| Click | Lock mouse / interact |
| WASD | Move |
| Space | Jump |
| Shift | Sprint |
| F | Toggle flashlight |
| E | Push drone away |
| Left Click | Collect highlighted orb |
| ESC | Unlock mouse |

---

## Scene Features

The environment is a **temple-style arena** built from multiple primitive meshes and decorative structures.

Features include:

- **Primitive 3D geometry** such as walls, pillars, stairs, platforms, arches, torch stands, and altar structures
- **Textured objects**
  - Floor texture
  - Wall texture
- **Animated objects**
  - Floating collectible relic orbs
  - Rotating trophy model
  - Moving enemy drone
- **Custom 3D model**
  - A **GLTF trophy model** placed on the altar
- **Skybox**
  - A cubemap sky surrounding the arena
- **Multiple light sources**
  - Ambient light
  - Hemisphere light
  - Directional light
  - Point lights for the altar, torches, and drone
  - Spot light attached to the player flashlight

---

## Gameplay

The objective is to **collect all 10 relic orbs** scattered across the temple while avoiding the hostile drone.

Gameplay systems include:

- Orb highlighting when the player aims at an orb
- Raycast-based orb collection
- Floating and pulsing orb animation
- Enemy drone AI with **patrol, chase, search, and retreat** behavior
- Radar system showing the drone’s direction relative to the player
- Health system with visual damage feedback
- Push mechanic that lets the player repel the drone at close range
- Flashlight that can be toggled on and off
- Win score based on **time** and **remaining health**

The game ends when either:

- All relic orbs are collected (**win condition**)
- Player health reaches zero (**loss condition**)

---

## Wow Feature

This project goes beyond a static 3D scene by implementing a **playable first-person mini-game** with multiple interacting systems.

Notable features include:

- Pointer-lock first-person movement and camera control
- Collision-based exploration with platforms and stairs
- Drone enemy AI with multiple states and reactive behavior
- Radar tracking system for spatial awareness
- Health, damage flash, and chase warning effects
- Orb collection system with highlighting and progress UI
- Flashlight attached to the player camera
- HUD showing orb progress, time, and health
- Final win screen with score calculation

Together, these features create a more immersive and game-like Three.js experience rather than just a rendered scene.