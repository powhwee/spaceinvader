import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState } from './types';
import { INITIAL_LIVES } from './constants';
import { WebGPURenderer } from './renderer';
import { AudioManager, SoundEffect, soundFiles } from './audio';
import { GameEngine } from './GameEngine';
import { InputManager } from './InputManager';

const GameUI: React.FC<{ score: number; lives: number, cameraYOffset: number }> = ({ score, lives, cameraYOffset }) => (
    <div className="relative p-4 flex justify-between text-2xl text-cyan-400 font-['VT323'] pointer-events-none">
        <div>
            <p>SCORE: {score}</p>
        </div>

        <div>
            <p>LIVES: {'<'.repeat(lives).padEnd(INITIAL_LIVES, ' ')}</p>
        </div>
    </div>
);

const ScreenOverlay: React.FC<{ children: React.ReactNode, className?: string }> = ({ children, className }) => (
    <div className={`absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center text-center p-8 ${className}`}>
        {children}
    </div>
);

const StartScreen: React.FC<{ onStart: () => void, isRendererReady: boolean, isAudioPreloaded: boolean, isAudioInitializing: boolean }> = ({ onStart, isRendererReady, isAudioPreloaded, isAudioInitializing }) => {
    const canStart = isRendererReady && isAudioPreloaded;

    let buttonText = 'LOADING ASSETS...';
    if (isAudioInitializing) {
        buttonText = 'INITIALIZING AUDIO...';
    } else if (canStart) {
        buttonText = 'INITIATE';
    }

    return (
        <ScreenOverlay>
            <h1 className="text-5xl text-cyan-400 font-title mb-4 animate-pulse">SPACE INVADERS</h1>
            <p className="text-xl text-green-400 mb-8 max-w-lg">A 3D rendition of the arcade classic using WebGPU. </p>
            <p className="text-lg text-gray-400 mb-2">[A][D] or [LEFT][RIGHT] to move. [SPACE] to fire.</p>
            <p className="text-lg text-gray-400 mb-2">[UP][DOWN] to change camera perspective.</p>
            <button
                onClick={onStart}
                disabled={!canStart || isAudioInitializing}
                className="mt-4 px-8 py-4 bg-green-500 text-black font-bold text-2xl font-title border-2 border-green-700 hover:bg-green-400 hover:border-green-600 transition-all disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
                {buttonText}
            </button>
        </ScreenOverlay>
    );
};

const GameOverScreen: React.FC<{ score: number; onRestart: () => void }> = ({ score, onRestart }) => (
    <ScreenOverlay>
        <h1 className="text-6xl text-red-500 font-title mb-4">GAME OVER</h1>
        <p className="text-3xl text-green-400 mb-8">FINAL SCORE: {score}</p>
        <button
            onClick={onRestart}
            className="mt-4 px-8 py-4 bg-cyan-500 text-black font-bold text-2xl font-title border-2 border-cyan-700 hover:bg-cyan-400 hover:border-cyan-600 transition-all"
        >
            PLAY AGAIN
        </button>
    </ScreenOverlay>
);

const OnScreenControls: React.FC<{ onButtonPress: (key: string) => void; onButtonRelease: (key: string) => void; }> = ({ onButtonPress, onButtonRelease }) => {
    // REFACTOR: Use Pointer Capture + Bounding Box Check to fix "Sticky" drift.
    // Use refs to track button state to avoid closure staleness issues if possible, 
    // though here we rely on the component re-rendering or stable callbacks.

    const handlePointerDown = (key: string) => (e: React.PointerEvent) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onButtonPress(key);
    };

    const handlePointerMove = (key: string) => (e: React.PointerEvent) => {
        e.preventDefault();
        // Check if the pointer is still physically within the button's bounds
        // even though we have capture.
        const rect = e.currentTarget.getBoundingClientRect();
        const isInside = (
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom
        );

        if (isInside) {
            onButtonPress(key);
        } else {
            onButtonRelease(key);
        }
    };

    const handlePointerUp = (key: string) => (e: React.PointerEvent) => {
        e.preventDefault();
        e.currentTarget.releasePointerCapture(e.pointerId);
        onButtonRelease(key);
    };

    const handlePointerCancel = (key: string) => (e: React.PointerEvent) => {
        e.preventDefault();
        onButtonRelease(key);
    };

    const dirBtnClass = "w-16 h-16 bg-cyan-500/50 text-white font-bold rounded-full border-2 border-cyan-700/80 flex items-center justify-center select-none touch-none active:bg-cyan-400/80 active:scale-95 transition-transform";
    const fireBtnClass = "w-24 h-24 bg-green-500/50 text-white font-bold rounded-full border-2 border-green-700/80 flex items-center justify-center text-2xl select-none touch-none active:bg-green-400/80 active:scale-95 transition-transform";

    return (
        <div
            className="absolute bottom-0 left-0 right-0 p-4 flex justify-between items-end z-10 pointer-events-auto select-none touch-none"
            style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
        >
            {/* Movement and Camera Controls */}
            <div className="flex flex-col items-center space-y-2">
                <button
                    className={dirBtnClass}
                    onPointerDown={handlePointerDown('ArrowUp')}
                    onPointerMove={handlePointerMove('ArrowUp')}
                    onPointerUp={handlePointerUp('ArrowUp')}
                    onPointerCancel={handlePointerCancel('ArrowUp')}
                >
                    ▲
                </button>
                <div className="flex space-x-2">
                    <button
                        className={dirBtnClass}
                        onPointerDown={handlePointerDown('ArrowLeft')}
                        onPointerMove={handlePointerMove('ArrowLeft')}
                        onPointerUp={handlePointerUp('ArrowLeft')}
                        onPointerCancel={handlePointerCancel('ArrowLeft')}
                    >
                        ◀
                    </button>
                    <button
                        className={dirBtnClass}
                        onPointerDown={handlePointerDown('ArrowDown')}
                        onPointerMove={handlePointerMove('ArrowDown')}
                        onPointerUp={handlePointerUp('ArrowDown')}
                        onPointerCancel={handlePointerCancel('ArrowDown')}
                    >
                        ▼
                    </button>
                    <button
                        className={dirBtnClass}
                        onPointerDown={handlePointerDown('ArrowRight')}
                        onPointerMove={handlePointerMove('ArrowRight')}
                        onPointerUp={handlePointerUp('ArrowRight')}
                        onPointerCancel={handlePointerCancel('ArrowRight')}
                    >
                        ▶
                    </button>
                </div>
            </div>

            {/* Fire Button */}
            <button
                className={fireBtnClass}
                onPointerDown={handlePointerDown(' ')}
                onPointerMove={handlePointerMove(' ')}
                onPointerUp={handlePointerUp(' ')}
                onPointerCancel={handlePointerCancel(' ')}
            >
                FIRE
            </button>
        </div>
    );
};


const App: React.FC = () => {
    const [uiState, setUiState] = useState({
        gameState: GameState.StartMenu,
        score: 0,
        lives: INITIAL_LIVES,
        cameraYOffset: 0,
    });
    const [isRendererReady, setIsRendererReady] = useState(false);
    const [isAudioPreloaded, setIsAudioPreloaded] = useState(false);
    const [isAudioInitialized, setIsAudioInitialized] = useState(false);
    const [isAudioInitializing, setIsAudioInitializing] = useState(false);
    const [isTouchDevice, setIsTouchDevice] = useState(false);

    const gameEngine = useRef<GameEngine | null>(null);
    const inputManager = useRef<InputManager | null>(null);
    const lastFrameTime = useRef<number>(performance.now());
    const animationFrameId = useRef<number>(0);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameContainerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<WebGPURenderer | null>(null);
    const audioManagerRef = useRef<AudioManager | null>(null);
    const soundDataRef = useRef<Map<SoundEffect, ArrayBuffer>>(new Map());

    useEffect(() => {
        setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);

        if (!canvasRef.current) return;

        if (!rendererRef.current) {
            const renderer = new WebGPURenderer(canvasRef.current);
            rendererRef.current = renderer;

            renderer.init().then((success) => {
                if (success) {
                    setIsRendererReady(true);
                    if (gameContainerRef.current) {
                        const { width, height } = gameContainerRef.current.getBoundingClientRect();
                        renderer.resize(width, height);
                    }
                } else {
                    console.error("Failed to initialize WebGPU renderer.");
                }
            });
        }

        inputManager.current = new InputManager();
        gameEngine.current = new GameEngine(inputManager.current);

        const resizeObserver = new ResizeObserver(entries => {
            if (!entries || entries.length === 0 || !rendererRef.current) return;
            const { width, height } = entries[0].contentRect;
            rendererRef.current.resize(width, height);
        });

        if (gameContainerRef.current) {
            resizeObserver.observe(gameContainerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
            gameEngine.current?.destroy();
        };
    }, []);

    useEffect(() => {
        const prefetchAllSounds = async () => {
            const fetchPromises = Object.entries(soundFiles).map(async ([key, path]) => {
                try {
                    const response = await fetch(path);
                    const arrayBuffer = await response.arrayBuffer();
                    soundDataRef.current.set(key as SoundEffect, arrayBuffer);
                } catch (e) {
                    console.error(`Failed to fetch sound: ${key}`, e);
                }
            });
            await Promise.all(fetchPromises);
            setIsAudioPreloaded(true);
        };
        prefetchAllSounds();
    }, []);

    const startGame = useCallback(async () => {
        if (isAudioInitializing || !gameEngine.current) return;

        const startEngineAndSyncState = () => {
            gameEngine.current!.startGame();
            setUiState(prev => ({ ...prev, ...gameEngine.current!.getState() }));
        };

        if (audioManagerRef.current && isAudioInitialized) {
            startEngineAndSyncState();
            return;
        }

        setIsAudioInitializing(true);

        const audioManager = audioManagerRef.current ?? new AudioManager();
        const audioReady = await audioManager.initialize();

        if (audioReady) {
            await audioManager.decodeSounds(soundDataRef.current);
            audioManagerRef.current = audioManager;
            gameEngine.current.setAudioManager(audioManager);
            setIsAudioInitialized(true);
        } else {
            console.error("Audio could not be initialized.");
        }

        setIsAudioInitializing(false);
        startEngineAndSyncState();

    }, [isAudioInitialized, isAudioInitializing]);

    useEffect(() => {
        if (uiState.gameState !== GameState.Playing || !isRendererReady) {
            return;
        }

        let frameId = 0;
        const gameLoop = (currentTime: number) => {
            if (!gameEngine.current || !rendererRef.current || !inputManager.current) {
                frameId = requestAnimationFrame(gameLoop);
                return;
            }

            const deltaTime = (currentTime - lastFrameTime.current) / 1000;
            lastFrameTime.current = currentTime;

            gameEngine.current.update(deltaTime, currentTime);
            const currentState = gameEngine.current.getState();

            setUiState({
                ...currentState,
                pressedKeys: { ...inputManager.current.keys },
            });

            rendererRef.current.render({
                player: currentState.player,
                invaders: currentState.invaders,
                playerLasers: currentState.playerLasers,
                invaderLasers: currentState.invaderLasers,
                particles: currentState.particles,
            }, currentState.cameraYOffset, deltaTime);

            frameId = requestAnimationFrame(gameLoop);
        };

        lastFrameTime.current = performance.now();
        frameId = requestAnimationFrame(gameLoop);

        return () => {
            cancelAnimationFrame(frameId);
        };
    }, [uiState.gameState, isRendererReady]);

    return (
        <div
            ref={gameContainerRef}
            className="game-container relative bg-[#0d0d0d] overflow-hidden border-2 border-green-500/50 shadow-[0_0_25px_rgba(74,222,128,0.4)] select-none touch-none"
            onContextMenu={(e) => e.preventDefault()}
            style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        >
            <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />

            <div className="absolute top-0 left-0 w-full h-full">
                {uiState.gameState !== GameState.Playing ? (
                    <div className="pointer-events-auto">
                        {uiState.gameState === GameState.StartMenu && <StartScreen onStart={startGame} isRendererReady={isRendererReady} isAudioPreloaded={isAudioPreloaded} isAudioInitializing={isAudioInitializing} />}
                        {uiState.gameState === GameState.GameOver && <GameOverScreen score={uiState.score} onRestart={startGame} />}
                    </div>
                ) : (
                    <>
                        <GameUI score={uiState.score} lives={uiState.lives} cameraYOffset={uiState.cameraYOffset} />
                        {isTouchDevice && <OnScreenControls onButtonPress={(key) => { if (inputManager.current) inputManager.current.keys[key] = true; }} onButtonRelease={(key) => { if (inputManager.current) inputManager.current.keys[key] = false; }} />}
                    </>
                )}
            </div>
        </div>
    );
};

export default App;