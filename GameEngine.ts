import {
    GAME_WIDTH, GAME_HEIGHT, PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_DEPTH, PLAYER_SPEED, PLAYER_Y_OFFSET,
    LASER_WIDTH, LASER_HEIGHT, LASER_DEPTH, PLAYER_LASER_SPEED, INVADER_LASER_SPEED, LASER_COOLDOWN,
    INVADER_WIDTH, INVADER_HEIGHT, INVADER_DEPTH, INVADER_ROWS, INVADER_COLS, INVADER_SPACING,
    INVADER_INITIAL_Y, INITIAL_INVADER_SPEED, INVADER_SPEED_INCREMENT, INVADER_DROP_DOWN_AMOUNT,
    INVADER_FIRE_CHANCE, INITIAL_LIVES
} from './constants';
import { GameState, ModelType } from './types';
import type { Player, Invader, Laser, Particle, Position } from './types';
import { AudioManager, SoundEffect } from './audio';
import { InputManager } from './InputManager';

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

export class GameEngine {
    public gameState: GameState = GameState.StartMenu;
    public score = 0;
    public lives = INITIAL_LIVES;
    public cameraYOffset = 0;

    public player: Player;
    public invaders: Invader[] = [];
    public playerLasers: Laser[] = [];
    public invaderLasers: Laser[] = [];
    public particles: Particle[] = [];

    private invaderDirection: 'right' | 'left' = 'right';
    private invaderSpeed = INITIAL_INVADER_SPEED;
    private lastPlayerFireTime = 0;

    private audioManager?: AudioManager;
    public inputManager: InputManager;

    constructor(inputManager: InputManager, audioManager?: AudioManager) {
        this.audioManager = audioManager;
        this.inputManager = inputManager;
        this.player = this.createPlayer();
        this.invaders = createInvaders();
    }

    private createPlayer(): Player {
        return {
            id: 1,
            position: { x: (GAME_WIDTH - PLAYER_WIDTH) / 2, y: PLAYER_Y_OFFSET, z: 0 },
            size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT, depth: PLAYER_DEPTH },
            modelType: ModelType.PlayerShip,
        };
    }

    public setAudioManager(audioManager: AudioManager) {
        this.audioManager = audioManager;
    }

    public startGame() {
        this.resetGame();
        this.gameState = GameState.Playing;
    }

    public resetGame() {
        this.inputManager.resetKeys();
        this.player = this.createPlayer();
        this.invaders = createInvaders();
        this.playerLasers = [];
        this.invaderLasers = [];
        this.particles = [];
        this.invaderDirection = 'right';
        this.invaderSpeed = INITIAL_INVADER_SPEED;
        this.score = 0;
        this.lives = INITIAL_LIVES;
        this.gameState = GameState.StartMenu;
        this.cameraYOffset = 0;
    }

    private createExplosion(position: Position, count: number, color: number[]) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const pitch = Math.random() * Math.PI - Math.PI / 2;
            const speed = Math.random() * 150 + 50;
            const life = Math.random() * 0.5 + 0.5;

            this.particles.push({
                id: performance.now() + Math.random(),
                position: { ...position },
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
    }

    private checkCollision(obj1: Player | Laser | Particle, obj2: Player | Laser | Invader): boolean {
        return (
            obj1.position.x < obj2.position.x + obj2.size.width &&
            obj1.position.x + obj1.size.width > obj2.position.x &&
            obj1.position.y < obj2.position.y + obj2.size.height &&
            obj1.position.y + obj1.size.height > obj2.position.y &&
            obj1.position.z < obj2.position.z + obj2.size.depth &&
            obj1.position.z + obj1.size.depth > obj2.position.z
        );
    }

    public update(deltaTime: number, currentTime: number) {
        if (this.gameState !== GameState.Playing) return;

        // Player movement
        let newPlayerX = this.player.position.x;
        if (this.inputManager.isPressed('a') || this.inputManager.isPressed('ArrowLeft')) {
            newPlayerX -= PLAYER_SPEED * deltaTime;
        }
        if (this.inputManager.isPressed('d') || this.inputManager.isPressed('ArrowRight')) {
            newPlayerX += PLAYER_SPEED * deltaTime;
        }
        if (this.inputManager.isPressed('ArrowUp')) {
            this.cameraYOffset = Math.min(this.cameraYOffset + 5, 200); // Limit max height
        }
        if (this.inputManager.isPressed('ArrowDown')) {
            this.cameraYOffset = Math.max(this.cameraYOffset - 5, -50); // Limit min height
        }

        this.player = {
            ...this.player,
            position: {
                ...this.player.position,
                x: Math.max(0, Math.min(GAME_WIDTH - PLAYER_WIDTH, newPlayerX)),
            }
        };

        // Player shooting
        if (this.inputManager.isPressed(' ') && currentTime - this.lastPlayerFireTime > LASER_COOLDOWN) {
            this.lastPlayerFireTime = currentTime;
            this.playerLasers.push({
                id: currentTime,
                position: {
                    x: this.player.position.x + PLAYER_WIDTH / 2 - LASER_WIDTH / 2,
                    y: this.player.position.y + PLAYER_HEIGHT,
                    z: this.player.position.z
                },
                size: { width: LASER_WIDTH, height: LASER_HEIGHT, depth: LASER_DEPTH },
                modelType: ModelType.Laser,
            });
            this.audioManager?.play(SoundEffect.PlayerShoot);
        }

        // Update positions
        this.playerLasers = this.playerLasers.map(l => ({ ...l, position: { ...l.position, y: l.position.y + PLAYER_LASER_SPEED * deltaTime } })).filter(l => l.position.y < GAME_HEIGHT);
        this.invaderLasers = this.invaderLasers.map(l => ({ ...l, position: { ...l.position, y: l.position.y - INVADER_LASER_SPEED * deltaTime } })).filter(l => l.position.y > 0);

        const gravity = -98.0;
        this.particles = this.particles.map(p => ({
            ...p,
            position: {
                x: p.position.x + p.velocity.x * deltaTime,
                y: p.position.y + p.velocity.y * deltaTime,
                z: p.position.z + p.velocity.z * deltaTime,
            },
            velocity: { ...p.velocity, y: p.velocity.y + gravity * deltaTime },
            life: p.life - deltaTime,
        })).filter(p => p.life > 0);

        // Invader movement
        const originalInvaderDirection = this.invaderDirection;
        let invadersHitWall = false;

        // 1. Predict next position to check for wall hits
        for (const invader of this.invaders) {
            const nextX = invader.position.x + (originalInvaderDirection === 'right' ? this.invaderSpeed : -this.invaderSpeed) * deltaTime;
            if (nextX <= 0 || nextX + INVADER_WIDTH >= GAME_WIDTH) { // Using <= and >= for safer bounds
                invadersHitWall = true;
                break;
            }
        }

        // 2. State Update if Hit
        if (invadersHitWall) {
            this.invaderDirection = originalInvaderDirection === 'right' ? 'left' : 'right';
            this.invaderSpeed += INVADER_SPEED_INCREMENT;
        }

        // 3. Move Invaders
        this.invaders = this.invaders.map(invader => {
            let nextX = invader.position.x + (originalInvaderDirection === 'right' ? this.invaderSpeed : -this.invaderSpeed) * deltaTime;
            let nextY = invader.position.y;

            if (invadersHitWall) {
                // DROP DOWN
                nextY -= INVADER_DROP_DOWN_AMOUNT;

                // CRITICAL FIX: Clamp to edge immediately to prevent double-triggering next frame
                if (originalInvaderDirection === 'right') {
                    // Hit Right Wall -> Clamp to Right Edge
                    nextX = Math.min(nextX, GAME_WIDTH - INVADER_WIDTH - 1); // -1 buffer
                } else {
                    // Hit Left Wall -> Clamp to Left Edge
                    nextX = Math.max(nextX, 1); // +1 buffer
                }
            }

            return {
                ...invader,
                position: {
                    ...invader.position,
                    x: nextX,
                    y: nextY,
                }
            };
        });

        // Invader shooting
        this.invaders.forEach(invader => {
            if (Math.random() < INVADER_FIRE_CHANCE) {
                this.invaderLasers.push({
                    id: performance.now() + invader.id,
                    position: {
                        x: invader.position.x + INVADER_WIDTH / 2 - LASER_WIDTH / 2,
                        y: invader.position.y,
                        z: invader.position.z
                    },
                    size: { width: LASER_WIDTH, height: LASER_HEIGHT, depth: LASER_DEPTH },
                    modelType: ModelType.Laser,
                });
                this.audioManager?.play(SoundEffect.InvaderShoot);
            }
        });

        // Collision detection
        this.handleCollisions();

        // Check game over conditions
        if (this.invaders.some(invader => invader.position.y <= this.player.position.y + PLAYER_HEIGHT) || this.invaders.length === 0) {
            this.gameState = GameState.GameOver;
        }
    }

    private handleCollisions() {
        const invadersToRemove = new Set<number>();
        const lasersToRemove = new Set<number>();
        const invaderColors = [
            [236 / 255, 72 / 255, 153 / 255, 1.0], [168 / 255, 85 / 255, 247 / 255, 1.0],
            [250 / 255, 204 / 255, 21 / 255, 1.0], [34 / 255, 197 / 255, 94 / 255, 1.0],
            [249 / 255, 115 / 255, 22 / 255, 1.0],
        ];

        this.playerLasers.forEach(laser => {
            this.invaders.forEach(invader => {
                if (!invadersToRemove.has(invader.id) && !lasersToRemove.has(laser.id) && this.checkCollision(laser, invader)) {
                    invadersToRemove.add(invader.id);
                    lasersToRemove.add(laser.id);
                    this.score += 10 * (INVADER_ROWS - invader.type);
                    this.audioManager?.play(SoundEffect.InvaderKilled);

                    const explosionPosition = {
                        x: invader.position.x + invader.size.width / 2,
                        y: invader.position.y + invader.size.height / 2,
                        z: invader.position.z + invader.size.depth / 2,
                    };
                    const explosionColor = invaderColors[invader.type % invaderColors.length];
                    this.createExplosion(explosionPosition, 1000, explosionColor);
                }
            });
        });

        if (invadersToRemove.size > 0) {
            this.invaders = this.invaders.filter(i => !invadersToRemove.has(i.id));
            this.playerLasers = this.playerLasers.filter(l => !lasersToRemove.has(l.id));
        }

        const playerLaserHits: number[] = [];
        this.invaderLasers.forEach(laser => {
            if (this.checkCollision(laser, this.player)) {
                playerLaserHits.push(laser.id);
                this.audioManager?.play(SoundEffect.PlayerDeath);
                const explosionPosition = {
                    x: this.player.position.x + this.player.size.width / 2,
                    y: this.player.position.y + this.player.size.height / 2,
                    z: this.player.position.z + this.player.size.depth / 2,
                };
                this.createExplosion(explosionPosition, 100, [1.0, 1.0, 0.8, 1.0]);

                this.lives--;
                if (this.lives <= 0) {
                    this.gameState = GameState.GameOver;
                }
            }
        });

        if (playerLaserHits.length > 0) {
            this.invaderLasers = this.invaderLasers.filter(l => !playerLaserHits.includes(l.id));
        }
    }

    public getState() {
        return {
            player: this.player,
            invaders: this.invaders,
            playerLasers: this.playerLasers,
            invaderLasers: this.invaderLasers,
            particles: this.particles,
            score: this.score,
            lives: this.lives,
            gameState: this.gameState,
            cameraYOffset: this.cameraYOffset,
        };
    }

    public destroy() {
        this.inputManager.destroy();
    }
}
