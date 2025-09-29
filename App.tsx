import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState } from './types';
import type { Player, Invader, Laser, Particle } from './types';
import {
  GAME_WIDTH, GAME_HEIGHT, PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_SPEED, PLAYER_Y_OFFSET,
  LASER_WIDTH, LASER_HEIGHT, PLAYER_LASER_SPEED, INVADER_LASER_SPEED, LASER_COOLDOWN,
  INVADER_WIDTH, INVADER_HEIGHT, INVADER_ROWS, INVADER_COLS, INVADER_SPACING, INVADER_INITIAL_Y,
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
          y: row * INVADER_SPACING.y + INVADER_INITIAL_Y,
        },
        size: { width: INVADER_WIDTH, height: INVADER_HEIGHT },
        type: row,
      });
    }
  }
  return invaders;
};

const GameUI: React.FC<{ score: number; lives: number, cameraYOffset: number }> = ({ score, lives, cameraYOffset }) => (
    <div className="p-4 flex justify-between text-2xl text-cyan-400 font-['VT323']">
        <span>SCORE: {score}</span>
        <p>CAMERA_Y: {cameraYOffset.toFixed(2)}</p>
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
        <h1 className="text-6xl text-cyan-400 font-title mb-4 animate-pulse">SPACE INVADERS</h1>
        <p className="text-xl text-green-400 mb-8 max-w-lg">A low-level simulation of a high-stakes arcade classic. Created using Gemini AI over multiple iterations of changes.  The fate of the render pipeline is in your hands.</p>
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
  const [cameraYOffset, setCameraYOffset] = useState(150);

  const player = useRef<Player>({
    id: 1,
    position: { x: (GAME_WIDTH - PLAYER_WIDTH) / 2, y: GAME_HEIGHT - PLAYER_HEIGHT - PLAYER_Y_OFFSET },
    size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
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

  const createExplosion = useCallback((position: {x: number, y: number}, count: number, color: number[]) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 100 + 50; // pixels per second
      particles.current.push({
        id: performance.now() + Math.random(),
        position: { x: position.x, y: position.y },
        size: { width: 3, height: 3 },
        velocity: {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed,
        },
        life: Math.random() * 0.5 + 0.5, // 0.5 to 1.0 seconds lifetime
        color: color,
      });
    }
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new WebGPURenderer(canvasRef.current);
    renderer.init().then((success) => {
      if (success) {
        rendererRef.current = renderer;
        setIsRendererReady(true);
      } else {
        console.error("Failed to initialize WebGPU renderer.");
      }
    });
  }, []);
  
  const resetGame = useCallback(() => {
    player.current = {
      id: 1,
      position: { x: (GAME_WIDTH - PLAYER_WIDTH) / 2, y: GAME_HEIGHT - PLAYER_HEIGHT - PLAYER_Y_OFFSET },
      size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
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
  
  const startGame = useCallback(() => {
    if (!audioManagerRef.current) {
      const audioManager = new AudioManager();
      audioManager.initialize();
      audioManager.loadSounds();
      audioManagerRef.current = audioManager;
    }
    resetGame();
    setGameState(GameState.Playing);
  }, [resetGame]);

  const checkCollision = (obj1: Player | Laser, obj2: Player | Laser | Invader) => {
    return (
      obj1.position.x < obj2.position.x + obj2.size.width &&
      obj1.position.x + obj1.size.width > obj2.position.x &&
      obj1.position.y < obj2.position.y + obj2.size.height &&
      obj1.position.y + obj1.size.height > obj2.position.y
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
        position: { x: player.current.position.x + PLAYER_WIDTH / 2 - LASER_WIDTH / 2, y: player.current.position.y },
        size: { width: LASER_WIDTH, height: LASER_HEIGHT },
      });
      audioManagerRef.current?.play(SoundEffect.PlayerShoot);
    }

    // Move lasers
    playerLasers.current = playerLasers.current.map(l => ({ ...l, position: { ...l.position, y: l.position.y - PLAYER_LASER_SPEED * deltaTime } })).filter(l => l.position.y > -LASER_HEIGHT);
    invaderLasers.current = invaderLasers.current.map(l => ({ ...l, position: { ...l.position, y: l.position.y + INVADER_LASER_SPEED * deltaTime } })).filter(l => l.position.y < GAME_HEIGHT);

    // Update particles
    const gravity = 98.0;
    particles.current = particles.current.map(p => ({
        ...p,
        position: {
            x: p.position.x + p.velocity.x * deltaTime,
            y: p.position.y + p.velocity.y * deltaTime,
        },
        velocity: {
            ...p.velocity,
            y: p.velocity.y + gravity * deltaTime,
        },
        life: p.life - deltaTime,
    })).filter(p => p.life > 0);

    // Move invaders
    let invadersHitWall = false;
    invaders.current = invaders.current.map(invader => {
      let invX = invader.position.x;
      if (invaderDirection.current === 'right') {
        invX += invaderSpeed.current * deltaTime;
        if (invX + INVADER_WIDTH > GAME_WIDTH) invadersHitWall = true;
      } else {
        invX -= invaderSpeed.current * deltaTime;
        if (invX < 0) invadersHitWall = true;
      }
      return { ...invader, position: { ...invader.position, x: invX } };
    });

    if (invadersHitWall) {
      invaderDirection.current = invaderDirection.current === 'right' ? 'left' : 'right';
      invaderSpeed.current += INVADER_SPEED_INCREMENT;
      invaders.current = invaders.current.map(invader => ({ ...invader, position: { ...invader.position, y: invader.position.y + INVADER_DROP_DOWN_AMOUNT } }));
    }

    // Invader firing
    invaders.current.forEach(invader => {
      if (Math.random() < INVADER_FIRE_CHANCE) {
        invaderLasers.current.push({
          id: performance.now() + invader.id,
          position: { x: invader.position.x + INVADER_WIDTH / 2 - LASER_WIDTH / 2, y: invader.position.y + INVADER_HEIGHT },
          size: { width: LASER_WIDTH, height: LASER_HEIGHT }
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
          };
          const explosionColor = invaderColors[invader.type % invaderColors.length];
          createExplosion(explosionPosition, 30, explosionColor);
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
    
    if (invaders.current.some(invader => invader.position.y + INVADER_HEIGHT >= player.current.position.y) || invaders.current.length === 0) {
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
        }, cameraYOffset);
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

export default App;