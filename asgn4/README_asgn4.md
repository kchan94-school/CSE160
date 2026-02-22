# AI Usage

I used LLMs (e.g. ChatGPT) for this assignment. I used it to help implement the requirements of this assignment as well as extra features/performance techniques. 


# CSE 160 – Assignment 
## Phong Lighting, Point Light, Spotlight, and OBJ Loading

This project implements a 3D scene with Phong shading in WebGL.

## Features

- Cube, spheres, voxel world, and animated animal
- Point light with position sliders and optional orbit animation
- Spotlight with direction and cutoff control
- Ambient, diffuse, and specular (Blinn-Phong) lighting
- Distance attenuation
- Normal visualization toggle
- Lighting on/off toggle
- OBJ model loading with lighting support
- WASD + mouse camera controls

## Controls

- **WASD** – Move camera  
- **Mouse** – Look around  
- **Q / E** – Move up/down  
- UI panel – Control lights, animation, and toggles  

## Implementation Notes

- Lighting calculated in fragment shader (Phong model)
- Normals transformed using inverse-transpose normal matrix
- Voxel wall cubes optimized (identity normal matrix for translations)
- Light marker cube rendered at light position

---