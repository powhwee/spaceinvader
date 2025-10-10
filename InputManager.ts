export class InputManager {
    public keys: Record<string, boolean> = {};

    private handleKeyDown = (e: KeyboardEvent) => {
        this.keys[e.key] = true;
    };

    private handleKeyUp = (e: KeyboardEvent) => {
        this.keys[e.key] = false;
    };

    constructor() {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
    }

    public isPressed(key: string): boolean {
        return this.keys[key] || false;
    }

    public destroy() {
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
    }
}
