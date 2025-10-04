# Space Invader game using WebGPU

This app is mostly generated and created using Google AI Studio. 
Features are added incrementally; the initial iteration was simply a 2D space invader game. 
This was then iterated multiple times to add in WebGPU, and then to continue to utilise WebGPU features.

This project is a 3D remake of the classic arcade game "Space Invaders," built using modern web technologies. It was developed with the assistance of Google's Gemini AI.

Here's a detailed breakdown of the project:

### High-Level Purpose

The goal of this project is to create a visually rich, 3D version of Space Invaders that runs in a web browser. It leverages the power of the WebGPU API for high-performance 3D graphics, demonstrating what's possible with modern web standards. The game features a 3D player ship, a fleet of 3D invaders, laser projectiles, and particle effects for explosions, all rendered in a 3D space.

### Core Technologies

*   **Frontend Framework:** **React** with **TypeScript** is used to structure the application and manage the game's state and UI (like the start menu, game over screen, and score display).
*   **3D Graphics:** **WebGPU** is the core rendering technology. This is a modern, low-level API that provides direct access to the GPU, allowing for high-performance graphics. The rendering logic is encapsulated in the `renderer.ts` file.
*   **Shading Language:** **WGSL (WebGPU Shading Language)** is used to write the vertex and fragment shaders that define how each object is drawn and lit in the 3D scene.
*   **Build Tool:** **Vite** is used for local development and building the project. It provides a fast development server with Hot Module Replacement (HMR) and is configured to use HTTPS, a requirement for WebGPU.
*   **3D Model Loading:** The **`@loaders.gl/gltf`** library is used to load the 3D model for the player's ship, which is in the GLTF format.
*   **Math:** The **`gl-matrix`** library is used for 3D math operations, such as matrix transformations for the camera and object positioning.
*   **Audio:** The native **Web Audio API** is used to handle sound effects for shooting, explosions, and player death.

### How It Works: Gameplay & Logic

The main game logic resides in `App.tsx`.

*   **Game State:** The game is managed by a state machine with three states: `StartMenu`, `Playing`, and `GameOver`.
*   **Game Loop:** A `requestAnimationFrame` loop in `App.tsx` drives the game's progression. On each frame, it:
    1.  **Handles Input:** Checks for keyboard input to move the player's ship left (`A`/`ArrowLeft`) and right (`D`/`ArrowRight`), fire lasers (`Space`), and adjust the camera's vertical position (`ArrowUp`/`ArrowDown`).
    2.  **Updates Positions:** Moves the player ship, lasers, and the swarm of invaders based on their speeds and the time elapsed since the last frame.
    3.  **Invader AI:** The invader fleet moves in unison. When an invader hits the edge of the screen, the entire fleet reverses direction, moves down, and increases its speed. Invaders also have a small, random chance to fire their own lasers.
    4.  **Collision Detection:** It checks for collisions between the player's lasers and the invaders, and between the invaders' lasers and the player.
    5.  **Updates State:** When a collision occurs, the game updates the score, removes the destroyed objects, and decrements the player's lives if hit. It also triggers particle explosions.
    6.  **Renders Scene:** It calls the `WebGPURenderer` to draw the updated scene.

### How It Works: The Rendering Pipeline

The `renderer.ts` file is the heart of the graphics engine.

1.  **Initialization:** It sets up the WebGPU device, canvas context, and a depth texture for correct 3D sorting.
2.  **Model Loading:**
    *   It loads the player's ship model from a `.gltf` file.
    *   It procedurally generates the geometry for the invaders (by combining small cubes into a pixel-art-style shape), lasers, and particles (which are icospheres).
3.  **Pipelines & Shaders:** It creates separate **render pipelines** for each type of object (player ship, invader, laser, particle). A pipeline bundles together the vertex and fragment shaders, buffer layouts, and blending/depth settings.
    *   **Player Ship Shader:** A sophisticated shader that uses textures for color and material properties (metallic/roughness) to create a realistic look with dynamic lighting.
    *   **Invader Shader:** A unique shader that creates a "dissolve" effect on the invaders, making them look like they are glitching or disintegrating over time.
    *   **Particle Shader:** A shader that makes particles fade out and change color over their lifetime, creating a convincing explosion effect.
4.  **Instanced Rendering:** To render thousands of objects (like particles) efficiently, the renderer uses **instancing**. It sends the geometry for a single object (e.g., one sphere) to the GPU once, and then provides a list of positions, sizes, and colors for all instances of that object. The GPU then draws all the instances in a single, highly efficient operation.
5.  **Render Pass:** In each frame, the renderer:
    *   Updates the camera matrices.
    *   Writes the latest data for all game objects (position, color, etc.) into a GPU buffer.
    *   Begins a "render pass," clearing the screen.
    *   Binds the appropriate pipeline and data for each model type and issues a draw call.
    *   Submits the commands to the GPU for rendering.

### Key Files in the Project

*   `index.html`: The entry point of the application, containing the canvas where the game is rendered.
*   `App.tsx`: The main React component holding the game logic, state, and UI.
*   `renderer.ts`: The WebGPU rendering engine.
*   `constants.ts`: A central file for all game parameters like speed, size, and counts, making it easy to tweak the gameplay.
*   `types.ts`: Defines the TypeScript data structures for all game objects (`Player`, `Invader`, `Laser`, etc.).
*   `models/`: A directory containing the geometry and shader code (WGSL) for each 3D object.
*   `public/`: Contains static assets like the 3D model for the player ship and the `.wav` files for sound effects.
*   `vite.config.ts`: The configuration file for the Vite development server.

## Run Locally

**Prerequisites:**  npm

1. Clone the repo:
   `git clone https://github.com/powhwee/spaceinvader.git`
2. Change directory into where the repo is checked out.
   `cd spaceinvader`
3. Install dependencies:
   `npm install`
4. Run the app:
   `npm run dev`

**Note:**  After you type 'npm run dev' it will give you a list of URLs that can be used to access the game.  Note that the URL is HTTPS not HTTP.  WebGPU requires transport to be TLS encrypted -- this is enforced by the browser.  If you disable SSL, you will only be able to run http://localhost only, and not accessible from a browser running on a different machine.