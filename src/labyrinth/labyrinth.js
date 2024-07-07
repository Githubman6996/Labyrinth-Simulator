import "./gl-matrix-min.js";
import { showError } from "./utils.js";
import { introTo3DDemo } from "./webgl.js";

const DIR_UP = 0;
const DIR_RIGHT = 1;
const DIR_DOWN = 2;
const DIR_LEFT = 3;

const memory = new WebAssembly.Memory({
    initial: 256,
    maximum: 512,
});

const wasm = await WebAssembly.instantiateStreaming(fetch("src/wasm/origin_shift.wasm"), {
    env: {
        emscripten_resize_heap: memory.grow,
    },
});
console.log(wasm);

// wasm.instance.exports.setSeed(Date.now());
wasm.instance.exports.setSeed(3);
const mem = new Uint32Array(wasm.instance.exports.memory.buffer);

const ROWS = 10;
const COLS = 10;
// 2500

const maze_struct = wasm.instance.exports.createMaze(ROWS, COLS);

function getMaze() {
    const maze = mem[maze_struct / Uint32Array.BYTES_PER_ELEMENT] / Uint32Array.BYTES_PER_ELEMENT;
    let hasUpdate = false;
    return Object.defineProperties(
        {
            size: { ROWS, COLS },
            shift(hunt, r, c, num) {
                if (hasUpdate) return;
                if (hunt) wasm.instance.exports.shiftOriginToPoint(maze_struct, ROWS, COLS, r, c);
                else wasm.instance.exports.shiftOrigin(maze_struct, ROWS, COLS);
                hasUpdate = true;
            },
        },
        {
            maze: {
                get: () => mem.slice(maze, maze + ROWS * COLS),
            },
            origin: {
                get: () => mem.slice(maze_struct / Uint32Array.BYTES_PER_ELEMENT + 1, maze_struct / Uint32Array.BYTES_PER_ELEMENT + 3),
            },
            hasUpdate: {
                get: () => {
                    if (hasUpdate) return !(hasUpdate = false);
                    return hasUpdate;
                },
            },
        }
    );
}

let maze = getMaze();

try {
    introTo3DDemo(maze);
} catch (e) {
    showError(e);
}

// updateMaze(maze.maze, ROWS, COLS);
// draw();

// console.log(maze);

// const HUNT = 0;
// const REST = 1;

// let state = HUNT,
//     huntCountdown = 1000,
//     curR,
//     curC,
//     randR,
//     randC;

window.onkeypress = (e) => e.code == "KeyF" && maze.shift();

setInterval(function () {
    maze.shift()
    // if (state == REST && huntCountdown-- <= 0) {
    //     state = HUNT;
    // }
    // let [r, c] = maze.origin;
    // if (curR == null || state == REST) wasm.instance.exports.shiftOrigin(maze_struct, ROWS, COLS);
    // else wasm.instance.exports.shiftOriginToPoint(maze_struct, ROWS, COLS, curR, curC);
    // if (r == curR && c == curC) {
    //     state = REST;
    //     huntCountdown = 1500;
    //     randR = Math.floor(Math.random() * ROWS);
    //     randC = Math.floor(Math.random() * COLS);
    // }

    // [r, c] = maze.origin;

}, 100);
