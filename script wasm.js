const DIR_UP = 0;
const DIR_RIGHT = 1;
const DIR_DOWN = 2;
const DIR_LEFT = 3;

const memory = new WebAssembly.Memory({
    initial: 256,
    maximum: 512,
});

const wasm = await WebAssembly.instantiateStreaming(fetch("src/origin_shift.wasm"), {
    env: {
        emscripten_resize_heap: memory.grow,
    },
});
console.log(wasm);

wasm.instance.exports.setSeed(Date.now());
const mem = new Uint32Array(wasm.instance.exports.memory.buffer);

const ROWS = 50;
const COLS = 50;

const maze_struct = wasm.instance.exports.createMaze(ROWS, COLS);

function getMaze() {
    const maze = mem[maze_struct / Uint32Array.BYTES_PER_ELEMENT] / Uint32Array.BYTES_PER_ELEMENT;
    return Object.defineProperties(
        {},
        {
            maze: {
                get: () => mem.slice(maze, maze + ROWS * COLS),
            },
            origin: {
                get: () => mem.slice(maze_struct / Uint32Array.BYTES_PER_ELEMENT + 1, maze_struct / Uint32Array.BYTES_PER_ELEMENT + 3),
            },
        }
    );
}

let maze = getMaze();

console.log(maze);

document.body.style.setProperty("--size", Math.min(innerHeight / (ROWS + 2), innerWidth / (COLS + 2)) + "px");
const mazeDiv = document.querySelector("#maze");
mazeDiv.innerHTML = "";

function textDir(dir) {
    switch (dir) {
        case DIR_UP:
            return "/\\";
        case DIR_DOWN:
            return "\\/";
        case DIR_LEFT:
            return "<";
        case DIR_RIGHT:
            return ">";
    }
}

{
    const mm = maze.maze;
    for (let r = 0; r < ROWS; r++) {
        const row = document.createElement("div");
        row.className = "row";
        mazeDiv.appendChild(row);
        for (let c = 0; c < COLS; c++) {
            const cell = document.createElement("div");
            cell.dataset.row = r;
            cell.dataset.col = c;
            cell.className = "cell";
            row.appendChild(cell);
            const span = document.createElement("span");
            span.innerHTML = textDir(mm[r * COLS + c]);
            cell.appendChild(span);

            cell.style.borderWidth = "1px";
            cell.style.borderStyle = "solid";

            updateBorders(r, c, mm);
        }
    }
}

setInterval(function () {
    let [r, c] = maze.origin;
    wasm.instance.exports.shiftOrigin(maze_struct, ROWS, COLS);
    const mm = maze.maze;
    let cell = mazeDiv.children[r].children[c];
    cell.querySelector("span").innerText = textDir(mm[r * COLS + c]);
    const cache = {};
    updateBorders(r, c, mm, 2, cache);

    [r, c] = maze.origin;

    cell = mazeDiv.children[r].children[c];
    cell.querySelector("span").innerText = "O";

    updateBorders(r, c, mm, 2, cache);
}, 0);

function getCell(maze, r, c) {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) return maze[r * COLS + c];
}

function updateBorders(r, c, maze, depth = 2, cache = {}) {
    if ((depth != 2 && cache[r + " " + c]) || depth <= 0 || r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    const cell = document.querySelector(`[data-row="${r}"][data-col="${c}"]`);
    if (!cell) return;
    cell.style.borderTopColor = maze[r * COLS + c] == 0 || getCell(maze, r - 1, c) == 2 ? "transparent" : "white";
    cell.style.borderBottomColor = maze[r * COLS + c] == 2 || getCell(maze, r + 1, c) == 0 ? "transparent" : "white";
    cell.style.borderRightColor = maze[r * COLS + c] == 1 || getCell(maze, r, c + 1) == 3 ? "transparent" : "white";
    cell.style.borderLeftColor = maze[r * COLS + c] == 3 || getCell(maze, r, c - 1) == 1 ? "transparent" : "white";
    cache[r + " " + c] = true;
    updateBorders(r - 1, c, maze, depth - 1, cache);
    updateBorders(r + 1, c, maze, depth - 1, cache);
    updateBorders(r, c - 1, maze, depth - 1, cache);
    updateBorders(r, c + 1, maze, depth - 1, cache);
}
