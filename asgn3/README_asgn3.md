# AI Usage

I used LLMs (e.g. ChatGPT) for this assignment. It was tremenously helpful on implementing alot of the various features that I wanted for this project. Almost 2k lines of code (sorry grader if you have to read all of it). Like for example I really wanted to get the physics right; being able to jump over blocks and going under them. Although it was still a big pain to code even with the help of an LLM. This is definitely the hardest assignment has of late.


---

# 🦚 ASG3 – Interactive Voxel World (WebGL)

A small Minecraft-style voxel world built in WebGL with first-person controls, physics, textures, and a fully animated peacock companion.

---

## 🎮 Controls

### Movement
- **W / A / S / D** — Move forward / left / back / right  
- **Mouse** — Look around *(click canvas to lock cursor)*  
- **Q / E** — Turn left / right  
- **Space** — Jump *(gravity + collision)*  

### Building
- **Left Click** — Remove block  
- **Right Click** — Place block on the face you’re looking at  
- **Middle Click** — Pick block type from the world  
- **Mouse Wheel** or **1–4** — Change selected block in hotbar  

### World / Extra
- **T** — Toggle **Day / Night / Auto**  
- **F** — Trigger peacock “poke” animation  

---

## 🌍 Unique Features

### 🧱 Minecraft-Style Voxel Editing
- **Multiple block textures** (wall / grass / stone / dirt)
- **Hotbar UI** with scroll + number key selection
- **Face-based placement** + distance check (can’t place inside the player)

### 🧍 Player Physics
- Gravity, jumping, and falling
- Floor/ceiling collision handling
- Step-up movement over blocks (small ledge stepping)
- First-person camera with mouse look (pointer lock)

### 🌤️ Day/Night Cycle + Stars
- AUTO day-night cycle with dusk lighting
- Global light tint affects the whole world
- Night sky spawns procedural star “particles”
- Manual toggle: **AUTO / DAY / NIGHT**

### 🦚 Animated Peacock
- Idle/walk animation (legs, wings, neck, tail)
- Special “poke” animation + tail fan behavior

---