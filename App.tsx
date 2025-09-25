
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState } from './types';
import type { Position, GameObject, Invader, Laser } from './types';
import {
  GAME_WIDTH, GAME_HEIGHT, PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_SPEED, PLAYER_Y_OFFSET,
  LASER_WIDTH, LASER_HEIGHT, PLAYER_LASER_SPEED, INVADER_LASER_SPEED, LASER_COOLDOWN,
  INVADER_WIDTH, INVADER_HEIGHT, INVADER_ROWS, INVADER_COLS, INVADER_SPACING, INVADER_INITIAL_Y,
  INITIAL_INVADER_SPEED, INVADER_SPEED_INCREMENT, INVADER_DROP_DOWN_AMOUNT, INVADER_FIRE_CHANCE, INITIAL_LIVES
} from './constants';
import { PlayerComponent, InvaderComponent, LaserComponent } from './components/GameElements';

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

const GameUI: React.FC<{ score: number; lives: number }> = ({ score, lives }) => (
    <div className="absolute top-0 left-0 right-0 p-4 flex justify-between text-2xl text-cyan-400 font-['VT323']">
        <span>SCORE: {score}</span>
        <span>LIVES: {'<'.repeat(lives).padEnd(INITIAL_LIVES, ' ')}</span>
    </div>
);

const ScreenOverlay: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center text-center p-8">
        {children}
    </div>
);

const StartScreen: React.FC<{ onStart: () => void }> = ({ onStart }) => (
    <ScreenOverlay>
        <h1 className="text-6xl text-cyan-400 font-title mb-4 animate-pulse">VULKAN INVADERS</h1>
        <p className="text-xl text-green-400 mb-8 max-w-lg">A low-level simulation of a high-stakes arcade classic. The fate of the render pipeline is in your hands.</p>
        <p className="text-lg text-gray-400 mb-2">[A][D] or [LEFT][RIGHT] to move. [SPACE] to fire.</p>
        <button
            onClick={onStart}
            className="mt-4 px-8 py-4 bg-green-500 text-black font-bold text-2xl font-title border-2 border-green-700 hover:bg-green-400 hover:border-green-600 transition-all"
        >
            INITIATE
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
  const [player, setPlayer] = useState<GameObject>({
    id: 1,
    position: { x: (GAME_WIDTH - PLAYER_WIDTH) / 2, y: GAME_HEIGHT - PLAYER_HEIGHT - PLAYER_Y_OFFSET },
    size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
  });
  const [invaders, setInvaders] = useState<Invader[]>(createInvaders);
  const [playerLasers, setPlayerLasers] = useState<Laser[]>([]);
  const [invaderLasers, setInvaderLasers] = useState<Laser[]>([]);
  const [invaderDirection, setInvaderDirection] = useState<'right' | 'left'>('right');
  const [invaderSpeed, setInvaderSpeed] = useState<number>(INITIAL_INVADER_SPEED);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(INITIAL_LIVES);

  const keysPressed = useRef<Record<string, boolean>>({});
  const lastPlayerFireTime = useRef<number>(0);
  const lastFrameTime = useRef<number>(performance.now());
  const animationFrameId = useRef<number>(0);

  const resetGame = useCallback(() => {
    setPlayer({
      id: 1,
      position: { x: (GAME_WIDTH - PLAYER_WIDTH) / 2, y: GAME_HEIGHT - PLAYER_HEIGHT - PLAYER_Y_OFFSET },
      size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
    });
    setInvaders(createInvaders());
    setPlayerLasers([]);
    setInvaderLasers([]);
    setInvaderDirection('right');
    setInvaderSpeed(INITIAL_INVADER_SPEED);
    setScore(0);
    setLives(INITIAL_LIVES);
    setGameState(GameState.Playing);
  }, []);
  
  const startGame = useCallback(() => {
    resetGame();
  }, [resetGame]);

  const checkCollision = (obj1: GameObject, obj2: GameObject) => {
    return (
      obj1.position.x < obj2.position.x + obj2.size.width &&
      obj1.position.x + obj1.size.width > obj2.position.x &&
      obj1.position.y < obj2.position.y + obj2.size.height &&
      obj1.position.y + obj1.size.height > obj2.position.y
    );
  };

  const gameLoop = useCallback((currentTime: number) => {
    const deltaTime = (currentTime - lastFrameTime.current) / 1000; // in seconds
    lastFrameTime.current = currentTime;

    if (gameState !== GameState.Playing) return;
    
    // Player movement
    setPlayer(prevPlayer => {
      let newX = prevPlayer.position.x;
      if (keysPressed.current['a'] || keysPressed.current['ArrowLeft']) {
        newX -= PLAYER_SPEED * deltaTime;
      }
      if (keysPressed.current['d'] || keysPressed.current['ArrowRight']) {
        newX += PLAYER_SPEED * deltaTime;
      }
      newX = Math.max(0, Math.min(GAME_WIDTH - PLAYER_WIDTH, newX));
      return { ...prevPlayer, position: { ...prevPlayer.position, x: newX } };
    });

    // Player firing
    if (keysPressed.current[' '] && currentTime - lastPlayerFireTime.current > LASER_COOLDOWN) {
      lastPlayerFireTime.current = currentTime;
      setPlayerLasers(prev => [
        ...prev,
        {
          id: currentTime,
          position: { x: player.position.x + PLAYER_WIDTH / 2 - LASER_WIDTH / 2, y: player.position.y },
          size: { width: LASER_WIDTH, height: LASER_HEIGHT },
        },
      ]);
    }

    // Move lasers
    setPlayerLasers(prev => prev.map(l => ({ ...l, position: { ...l.position, y: l.position.y - PLAYER_LASER_SPEED * deltaTime } })).filter(l => l.position.y > -LASER_HEIGHT));
    setInvaderLasers(prev => prev.map(l => ({ ...l, position: { ...l.position, y: l.position.y + INVADER_LASER_SPEED * deltaTime } })).filter(l => l.position.y < GAME_HEIGHT));

    // Move invaders
    let invadersHitWall = false;
    let invadersDropDown = false;
    setInvaders(prevInvaders => {
      const newInvaders = prevInvaders.map(invader => {
        let newX = invader.position.x;
        if (invaderDirection === 'right') {
          newX += invaderSpeed * deltaTime;
          if (newX + INVADER_WIDTH > GAME_WIDTH) invadersHitWall = true;
        } else {
          newX -= invaderSpeed * deltaTime;
          if (newX < 0) invadersHitWall = true;
        }
        return { ...invader, position: { ...invader.position, x: newX } };
      });
      if (invadersHitWall) {
        invadersDropDown = true;
        setInvaderDirection(dir => (dir === 'right' ? 'left' : 'right'));
        setInvaderSpeed(s => s + INVADER_SPEED_INCREMENT);
        return prevInvaders.map(invader => ({ ...invader, position: { ...invader.position, y: invader.position.y + INVADER_DROP_DOWN_AMOUNT } }));
      }
      return newInvaders;
    });

    // Invader firing
    setInvaders(prevInvaders => {
        prevInvaders.forEach(invader => {
            if (Math.random() < INVADER_FIRE_CHANCE) {
                setInvaderLasers(prevLasers => [
                    ...prevLasers,
                    {
                        id: performance.now() + invader.id,
                        position: { x: invader.position.x + INVADER_WIDTH / 2 - LASER_WIDTH / 2, y: invader.position.y + INVADER_HEIGHT },
                        size: { width: LASER_WIDTH, height: LASER_HEIGHT }
                    }
                ]);
            }
        });
        return prevInvaders;
    });


    // Collision detection
    // Player laser hitting invader
    const newPlayerLasers = [...playerLasers];
    const newInvaders = [...invaders];
    const invadersToRemove: number[] = [];
    const lasersToRemove: number[] = [];

    newPlayerLasers.forEach(laser => {
      newInvaders.forEach(invader => {
        if (!invadersToRemove.includes(invader.id) && !lasersToRemove.includes(laser.id) && checkCollision(laser, invader)) {
          invadersToRemove.push(invader.id);
          lasersToRemove.push(laser.id);
          setScore(s => s + 10 * (INVADER_ROWS - invader.type));
        }
      });
    });

    if (invadersToRemove.length > 0) {
      setInvaders(prev => prev.filter(i => !invadersToRemove.includes(i.id)));
      setPlayerLasers(prev => prev.filter(l => !lasersToRemove.includes(l.id)));
    }
    
    // Invader laser hitting player
    invaderLasers.forEach(laser => {
        if (checkCollision(laser, player)) {
            setInvaderLasers(prev => prev.filter(l => l.id !== laser.id));
            setLives(l => {
                const newLives = l - 1;
                if (newLives <= 0) {
                    setGameState(GameState.GameOver);
                }
                return newLives;
            });
        }
    });

    // Game over conditions
    // Invaders reach bottom
    if (invaders.some(invader => invader.position.y + INVADER_HEIGHT >= player.position.y)) {
        setGameState(GameState.GameOver);
    }
    // All invaders defeated
    if (invaders.length === 0) {
        setGameState(GameState.GameOver);
        // You could add a "You Win!" message or transition to the next level here.
    }


    animationFrameId.current = requestAnimationFrame(gameLoop);
  }, [gameState, player.position.x, player.position.y, invaders, invaderLasers, playerLasers, invaderDirection, invaderSpeed]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current[e.key] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current[e.key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (gameState === GameState.Playing) {
      lastFrameTime.current = performance.now();
      animationFrameId.current = requestAnimationFrame(gameLoop);
    } else {
      cancelAnimationFrame(animationFrameId.current);
    }

    return () => cancelAnimationFrame(animationFrameId.current);
  }, [gameState, gameLoop]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div
        className="relative bg-[#0d0d0d] overflow-hidden border-2 border-green-500/50 shadow-[0_0_25px_rgba(74,222,128,0.4)]"
        style={{ width: GAME_WIDTH, height: GAME_HEIGHT }}
      >
        {gameState === GameState.StartMenu && <StartScreen onStart={startGame} />}
        {gameState === GameState.GameOver && <GameOverScreen score={score} onRestart={startGame} />}
        
        {gameState === GameState.Playing && (
          <>
            <GameUI score={score} lives={lives} />
            <PlayerComponent player={player} />
            {invaders.map(invader => (
              <InvaderComponent key={invader.id} invader={invader} />
            ))}
            {playerLasers.map(laser => (
              <LaserComponent key={laser.id} laser={laser} isPlayerLaser />
            ))}
            {invaderLasers.map(laser => (
              <LaserComponent key={laser.id} laser={laser} isPlayerLaser={false} />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default App;
