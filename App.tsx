import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, ModelType } from './types';
import type { Player, Invader, Laser, Particle, Position } from './types';
import {
  GAME_WIDTH, GAME_HEIGHT, 
  PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_DEPTH, PLAYER_SPEED, PLAYER_Y_OFFSET,
  LASER_WIDTH, LASER_HEIGHT, LASER_DEPTH, PLAYER_LASER_SPEED, INVADER_LASER_SPEED, LASER_COOLDOWN,
  INVADER_WIDTH, INVADER_HEIGHT, INVADER_DEPTH, INVADER_ROWS, INVADER_COLS, INVADER_SPACING, INVADER_INITIAL_Y,
  INITIAL_INVADER_SPEED, INVADER_SPEED_INCREMENT, INVADER_DROP_DOWN_AMOUNT, INVADER_FIRE_CHANCE, INITIAL_LIVES
} from './constants';
import { WebGPURenderer } from './renderer';
import { AudioManager, SoundEffect } from './audio';

const createInvaders = (): Invader[] => {
  const invaders: Invader[] = [];
  for (let row = 0; row < INVADER_ROWS; row++) {
    for (let col = 0; col < INVADER_COLS; col++) {
      invaders.push({
        id: Date.now() + row * INVADER_COLS + col,
        position: {
          x: col * INVADER_SPACING.x + (GAME_WIDTH - INVADER_COLS * INVADER_SPACING.x) / 2 + 5,
          y: (GAME_HEIGHT - INVADER_INITIAL_Y - INVADER_HEIGHT) - (row * INVADER_SPACING.y),
          z: 0,
        },
        size: { width: INVADER_WIDTH, height: INVADER_HEIGHT, depth: INVADER_DEPTH },
        type: row,
        modelType: ModelType.Invader,
      });
    }
  }
  return invaders;
};

const GameUI: React.FC<{ score: number; lives: number, cameraYOffset: number }> = ({ score, lives, cameraYOffset }) => (
    <div className="p-4 flex justify-between text-2xl text-cyan-400 font-['VT323']">
        <span>SCORE: {score}</span>
        <p>CAMERA_Y_OFFSET: {cameraYOffset.toFixed(2)}</p>
        <span>LIVES: {'<'.repeat(lives).padEnd(INITIAL_LIVES, ' ')}</span>
    </div>
);

const ScreenOverlay: React.FC<{ children: React.ReactNode, className?: string }> = ({ children, className }) => (
    <div className={`absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center text-center p-8 ${className}`}>
        {children}
    </div>
);

const StartScreen: React.FC<{ onStart: () => void, isReady: boolean }> = ({ onStart, isReady }) => (
    <ScreenOverlay>
        <h1 className="text-6xl text-cyan-400 font-title mb-4 animate-pulse">SPACE INVADERS 3D</h1>
        <p className="text-xl text-green-400 mb-8 max-w-lg">A 3D simulation of a high-stakes arcade classic. Created using Gemini AI. The fate of the render pipeline is in your hands.</p>
        <p className="text-lg text-gray-400 mb-2">[A][D] or [LEFT][RIGHT] to move. [SPACE] to fire.</p>
        <p className="text-lg text-gray-400 mb-2">[UP][DOWN] to change camera perspective.</p>
        <button
            onClick={onStart}
            disabled={!isReady}
            className="mt-4 px-8 py-4 bg-green-500 text-black font-bold text-2xl font-title border-2 border-green-700 hover:bg-green-400 hover:border-green-600 transition-all disabled:bg-gray-600 disabled:cursor-not-allowed"
        >
            {isReady ? 'INITIATE' : 'LOADING GPU...'}
        </button>
    </ScreenOverlay>
);

const GameOverScreen: React.FC<{ score: number; onRestart: () => void }> = ({ score, onRestart }) => (
    <ScreenOverlay>
        <h1 className="text-6xl text-red-500 font-title mb-4">GAME OVER</h1>
        <p className="text-3xl text-green-400 mb-8">FINAL SCORE: {score}</p>
        <button
            onClick={onRestart}
            className="mt-4 px-8 py-4 bg-cyan-500 text-black font-bold text-2xl font-title border-2 border-cyan-700 hover:bg-cyan-400 hover:border-cyan-600 transition-all"
        >
            RECOMPILE & RUN
        </button>
    </ScreenOverlay>
);


const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.StartMenu);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [isRendererReady, setIsRendererReady] = useState(false);
  const [cameraYOffset, setCameraYOffset] = useState(0);
  // const cameraYOffset = 0;

  const player = useRef<Player>({
    id: 1,
    position: { x: (GAME_WIDTH - PLAYER_WIDTH) / 2, y: PLAYER_Y_OFFSET, z: 0 },
    size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT, depth: PLAYER_DEPTH },
    modelType: ModelType.PlayerShip,
  });
  const invaders = useRef<Invader[]>(createInvaders());
  const playerLasers = useRef<Laser[]>([]);
  const invaderLasers = useRef<Laser[]>([]);
  const particles = useRef<Particle[]>([]);
  const invaderDirection = useRef<'right' | 'left'>('right');
  const invaderSpeed = useRef<number>(INITIAL_INVADER_SPEED);

  const keysPressed = useRef<Record<string, boolean>>({});
  const lastPlayerFireTime = useRef<number>(0);
  const lastFrameTime = useRef<number>(performance.now());
  const animationFrameId = useRef<number>(0);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGPURenderer | null>(null);
  const audioManagerRef = useRef<AudioManager | null>(null);

  const createExplosion = useCallback((position: Position, count: number, color: number[]) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const pitch = Math.random() * Math.PI - Math.PI / 2;
      const speed = Math.random() * 150 + 50; // pixels per second
      const life = Math.random() * 0.5 + 0.5; // 0.5 to 1.0 seconds lifetime

      particles.current.push({
        id: performance.now() + Math.random(),
        position: { x: position.x, y: position.y, z: position.z },
        size: { width: 15, height: 15, depth: 15 },
        velocity: {
          x: Math.cos(angle) * Math.cos(pitch) * speed,
          y: Math.sin(pitch) * speed,
          z: Math.sin(angle) * Math.cos(pitch) * speed,
        },
        life: life,
        initialLife: life,
        color: color,
        modelType: ModelType.Cube,
      });
    }
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = GAME_WIDTH * devicePixelRatio;
    canvas.height = GAME_HEIGHT * devicePixelRatio;

    // these 2 lines below ensure the high dpi screen is mapped to the 'logically' smaller size of the canvas on web browser.
    // if these 2 are not set, then the canvas will show only partial render of the scene.
    // I thought it should be the same as what is set in the css but that does not seems to have worked. 
    canvas.style.width = `${GAME_WIDTH}px`;
    canvas.style.height = `${GAME_HEIGHT}px`;
    

    // Defer renderer initialization to the next frame.
    // This helps prevent a race condition on Safari where the renderer might
    // initialize before the browser has fully processed the canvas's new dimensions.
    const animationFrameHandle = requestAnimationFrame(() => {
      const renderer = new WebGPURenderer(canvas);
      renderer.init().then((success) => {
        if (success) {
          rendererRef.current = renderer;
          setIsRendererReady(true);
        } else {
          console.error("Failed to initialize WebGPU renderer.");
        }
      });
    });

    return () => cancelAnimationFrame(animationFrameHandle);
  }, []);
  
  const resetGame = useCallback(() => {
    player.current = {
      id: 1,
      position: { x: (GAME_WIDTH - PLAYER_WIDTH) / 2, y: PLAYER_Y_OFFSET, z: 0 },
      size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT, depth: PLAYER_DEPTH },
      modelType: ModelType.PlayerShip,
    };
    invaders.current = createInvaders();
    playerLasers.current = [];
    invaderLasers.current = [];
    particles.current = [];
    invaderDirection.current = 'right';
    invaderSpeed.current = INITIAL_INVADER_SPEED;
    setScore(0);
    setLives(INITIAL_LIVES);
  }, []);
  
  const startGame = useCallback(async () => {
    if (!audioManagerRef.current) {
      const audioManager = new AudioManager();
      audioManager.initialize();
      await audioManager.loadSounds();
      audioManagerRef.current = audioManager;
    }
    resetGame();
    setGameState(GameState.Playing);
  }, [resetGame]);

  const checkCollision = (obj1: Player | Laser | Particle, obj2: Player | Laser | Invader) => {
    return (
      obj1.position.x < obj2.position.x + obj2.size.width &&
      obj1.position.x + obj1.size.width > obj2.position.x &&
      obj1.position.y < obj2.position.y + obj2.size.height &&
      obj1.position.y + obj1.size.height > obj2.position.y &&
      obj1.position.z < obj2.position.z + obj2.size.depth &&
      obj1.position.z + obj1.size.depth > obj2.position.z
    );
  };

  const gameLoop = useCallback((currentTime: number) => {
    const deltaTime = (currentTime - lastFrameTime.current) / 1000;
    lastFrameTime.current = currentTime;

    // Player movement
    let newX = player.current.position.x;
    if (keysPressed.current['a'] || keysPressed.current['ArrowLeft']) {
      newX -= PLAYER_SPEED * deltaTime;
    }
    if (keysPressed.current['d'] || keysPressed.current['ArrowRight']) {
      newX += PLAYER_SPEED * deltaTime;
    }
    player.current.position.x = Math.max(0, Math.min(GAME_WIDTH - PLAYER_WIDTH, newX));
    
    // Player firing
    if (keysPressed.current[' '] && currentTime - lastPlayerFireTime.current > LASER_COOLDOWN) {
      lastPlayerFireTime.current = currentTime;
      playerLasers.current.push({
        id: currentTime,
        position: { 
            x: player.current.position.x + PLAYER_WIDTH / 2 - LASER_WIDTH / 2, 
            y: player.current.position.y + PLAYER_HEIGHT, 
            z: player.current.position.z 
        },
        size: { width: LASER_WIDTH, height: LASER_HEIGHT, depth: LASER_DEPTH },
        modelType: ModelType.Laser,
      });
      audioManagerRef.current?.play(SoundEffect.PlayerShoot);
    }

    // Move lasers
    playerLasers.current = playerLasers.current.map(l => ({ ...l, position: { ...l.position, y: l.position.y + PLAYER_LASER_SPEED * deltaTime } })).filter(l => l.position.y < GAME_HEIGHT);
    invaderLasers.current = invaderLasers.current.map(l => ({ ...l, position: { ...l.position, y: l.position.y - INVADER_LASER_SPEED * deltaTime } })).filter(l => l.position.y > 0);

    // Update particles
    const gravity = -98.0; // Gravity pulls down in a Y-up system
    particles.current = particles.current.map(p => ({
        ...p,
        position: {
            x: p.position.x + p.velocity.x * deltaTime,
            y: p.position.y + p.velocity.y * deltaTime,
            z: p.position.z + p.velocity.z * deltaTime,
        },
        velocity: {
            ...p.velocity,
            y: p.velocity.y + gravity * deltaTime,
        },
        life: p.life - deltaTime,
    })).filter(p => p.life > 0);

    // Move invaders
    let invadersHitWall = false;
    invaders.current.forEach(invader => {
        if (invaderDirection.current === 'right') {
            invader.position.x += invaderSpeed.current * deltaTime;
            if (invader.position.x + INVADER_WIDTH > GAME_WIDTH) invadersHitWall = true;
        } else {
            invader.position.x -= invaderSpeed.current * deltaTime;
            if (invader.position.x < 0) invadersHitWall = true;
        }
    });

    if (invadersHitWall) {
      invaderDirection.current = invaderDirection.current === 'right' ? 'left' : 'right';
      invaderSpeed.current += INVADER_SPEED_INCREMENT;
      invaders.current.forEach(invader => invader.position.y -= INVADER_DROP_DOWN_AMOUNT);
    }

    // Invader firing
    invaders.current.forEach(invader => {
      if (Math.random() < INVADER_FIRE_CHANCE) {
        invaderLasers.current.push({
          id: performance.now() + invader.id,
          position: { 
              x: invader.position.x + INVADER_WIDTH / 2 - LASER_WIDTH / 2, 
              y: invader.position.y,
              z: invader.position.z
            },
          size: { width: LASER_WIDTH, height: LASER_HEIGHT, depth: LASER_DEPTH },
          modelType: ModelType.Laser,
        });
        audioManagerRef.current?.play(SoundEffect.InvaderShoot);
      }
    });

    // Collision detection
    const invadersToRemove = new Set<number>();
    const lasersToRemove = new Set<number>();
    const invaderColors = [
        [236/255, 72/255, 153/255, 1.0], [168/255, 85/255, 247/255, 1.0],
        [250/255, 204/255, 21/255, 1.0], [34/255, 197/255, 94/255, 1.0],
        [249/255, 115/255, 22/255, 1.0],
    ];

    playerLasers.current.forEach(laser => {
      invaders.current.forEach(invader => {
        if (!invadersToRemove.has(invader.id) && !lasersToRemove.has(laser.id) && checkCollision(laser, invader)) {
          invadersToRemove.add(invader.id);
          lasersToRemove.add(laser.id);
          setScore(s => s + 10 * (INVADER_ROWS - invader.type));
          audioManagerRef.current?.play(SoundEffect.InvaderKilled);
          
          const explosionPosition = {
              x: invader.position.x + invader.size.width / 2,
              y: invader.position.y + invader.size.height / 2,
              z: invader.position.z + invader.size.depth / 2,
          };
          const explosionColor = invaderColors[invader.type % invaderColors.length];
          createExplosion(explosionPosition, 1000, explosionColor);
        }
      });
    });

    if (invadersToRemove.size > 0) {
      invaders.current = invaders.current.filter(i => !invadersToRemove.has(i.id));
      playerLasers.current = playerLasers.current.filter(l => !lasersToRemove.has(l.id));
    }
    
    const playerLaserHits: number[] = [];
    invaderLasers.current.forEach(laser => {
      if (checkCollision(laser, player.current)) {
        playerLaserHits.push(laser.id);
        audioManagerRef.current?.play(SoundEffect.PlayerDeath);
        const explosionPosition = {
            x: player.current.position.x + player.current.size.width / 2,
            y: player.current.position.y + player.current.size.height / 2,
            z: player.current.position.z + player.current.size.depth / 2,
        };
        createExplosion(explosionPosition, 100, [1.0, 1.0, 0.8, 1.0]);

        setLives(l => {
          const newLives = l - 1;
          if (newLives <= 0) {
            setGameState(GameState.GameOver);
          }
          return newLives;
        });
      }
    });
    if(playerLaserHits.length > 0) {
        invaderLasers.current = invaderLasers.current.filter(l => !playerLaserHits.includes(l.id));
    }
    
    if (invaders.current.some(invader => invader.position.y <= player.current.position.y + PLAYER_HEIGHT) || invaders.current.length === 0) {
      setGameState(GameState.GameOver);
    }

    // Render frame
    if(rendererRef.current) {
        rendererRef.current.render({
            player: player.current,
            invaders: invaders.current,
            playerLasers: playerLasers.current,
            invaderLasers: invaderLasers.current,
            particles: particles.current,
        }, cameraYOffset, deltaTime);
    }

    animationFrameId.current = requestAnimationFrame(gameLoop);
  }, [createExplosion, cameraYOffset]);

  

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current[e.key] = true;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCameraYOffset(o => o + 30);
      }
      if (e.key === 'ArrowDown') {
       e.preventDefault();
        setCameraYOffset(o => o - 30);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => { keysPressed.current[e.key] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (gameState === GameState.Playing && isRendererReady) {
      lastFrameTime.current = performance.now();
      animationFrameId.current = requestAnimationFrame(gameLoop);
    } else {
      cancelAnimationFrame(animationFrameId.current);
    }
    return () => cancelAnimationFrame(animationFrameId.current);
  }, [gameState, gameLoop, isRendererReady]);

  return (
    <div
      className="relative bg-[#0d0d0d] overflow-hidden border-2 border-green-500/50 shadow-[0_0_25px_rgba(74,222,128,0.4)]"
      style={{ width: GAME_WIDTH, height: GAME_HEIGHT }}
    >
      <canvas ref={canvasRef} width={GAME_WIDTH} height={GAME_HEIGHT} className="absolute top-0 left-0" />
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
        {gameState !== GameState.Playing && (
          <div className="pointer-events-auto">
            {gameState === GameState.StartMenu && <StartScreen onStart={startGame} isReady={isRendererReady} />}
            {gameState === GameState.GameOver && <GameOverScreen score={score} onRestart={startGame} />}
          </div>
        )}
        {gameState === GameState.Playing && <GameUI score={score} lives={lives} cameraYOffset={cameraYOffset} />}
      </div>
    </div>
  );
};

export default App;App;