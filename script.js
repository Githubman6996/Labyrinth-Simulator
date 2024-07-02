const DIR_UP = 0;
const DIR_RIGHT = 1;
const DIR_DOWN = 2;
const DIR_LEFT = 3;

function createPerfectMaze(rows, columns) {
    const dir = Math.floor(Math.random() * 4);
    const maze = Array.from({ length: rows }, () => Array.from({ length: columns }, () => dir));
    let origin;
    switch (dir) {
        case DIR_UP:
            for (let i = 0; i < columns; i++) maze[0][i] = DIR_RIGHT;
            origin = [0, columns - 1];
            break;
        case DIR_DOWN:
            for (let i = 0; i < columns; i++) maze[rows - 1][i] = DIR_LEFT;
            origin = [rows - 1, 0];
            break;
        case DIR_LEFT:
            for (let i = 0; i < rows; i++) maze[i][0] = DIR_UP;
            origin = [0, 0];
            break;
        case DIR_RIGHT:
            for (let i = 0; i < rows; i++) maze[i][columns - 1] = DIR_DOWN;
            origin = [rows - 1, columns - 1];
            break;
    }
    return { maze, origin };
}

function nextPosition([...cur], dir, maze) {
    switch (dir) {
        case DIR_UP:
            cur[0]--;
            if (cur[0] < 0) return null;
            return cur;
        case DIR_DOWN:
            cur[0]++;
            if (cur[0] >= maze.length) return null;
            return cur;
        case DIR_RIGHT:
            cur[1]++;
            if (cur[1] >= maze[0].length) return null;
            return cur;
        case DIR_LEFT:
            cur[1]--;
            if (cur[1] < 0) return null;
            return cur;
    }
}

function shiftOrigin(data) {
    const { maze, origin } = data;
    let new_dir = Math.floor(Math.random() * 4),
        new_pos;
    while ((new_pos = nextPosition(origin, new_dir, maze)) == null) new_dir = Math.floor(Math.random() * 4);
    maze[origin[0]][origin[1]] = new_dir;
    data.origin = new_pos;
    return data;
}

const ROWS = 20;
const COLS = 20;

document.body.style.setProperty("--size", Math.min(innerHeight / (ROWS + 5), innerWidth / (COLS + 5)) + "px");

const maze = createPerfectMaze(ROWS, COLS);
const seenArr = new Uint8Array(Math.ceil((ROWS * COLS) / 8));
let needed = Math.floor(ROWS * COLS * 0.95) - 1;
needed = ROWS * COLS;
console.log(seenArr, needed);
// throw new Error();
while (needed > 0) {
    const { origin } = shiftOrigin(maze);
    const ind = origin[0] * ROWS + origin[1];
    const bit = ind % 8;
    if (((seenArr[Math.floor(ind / 8)] >> bit) & 1) == 0) {
        needed--;
        seenArr[Math.floor(ind / 8)] |= 1 << bit;
        // console.log(Array.prototype.map.call(seenArr, x => x.toString(2).padStart(8, "0")).join(""), Math.floor(ind / 8), bit);
    }
}
console.log(maze);

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
        span.innerHTML = textDir(maze.maze[r][c]);
        cell.appendChild(span);

        cell.style.borderWidth = "1px";
        cell.style.borderStyle = "solid";

        updateBorders(r, c, maze.maze);
    }
}

setInterval(function () {
    let [r, c] = maze.origin;
    shiftOrigin(maze);
    let cell = mazeDiv.children[r].children[c];
    cell.querySelector("span").innerText = textDir(maze.maze[r][c]);
    let cache = {};
    updateBorders(r, c, maze.maze, 2, cache);
    [r, c] = maze.origin;
    cell = mazeDiv.children[r].children[c];
    cell.querySelector("span").innerText = "O";
    updateBorders(r, c, maze.maze, 2, cache);
}, 100);

function updateBorders(r, c, maze, depth = 2, cache = {}) {
    if ((depth != 2 && cache[r + " " + c]) || depth <= 0 || r < 0 || r >= maze.length || c < 0 || c >= maze[r].length) return;
    const cell = document.querySelector(`[data-row="${r}"][data-col="${c}"]`);
    if (!cell) return;
    cell.style.borderTopColor = maze[r][c] == 0 || maze[r - 1]?.[c] == 2 ? "transparent" : "white";
    cell.style.borderBottomColor = maze[r][c] == 2 || maze[r + 1]?.[c] == 0 ? "transparent" : "white";
    cell.style.borderRightColor = maze[r][c] == 1 || maze[r][c + 1] == 3 ? "transparent" : "white";
    cell.style.borderLeftColor = maze[r][c] == 3 || maze[r][c - 1] == 1 ? "transparent" : "white";
    cache[r + " " + c] = true;
    updateBorders(r - 1, c, maze, depth - 1, cache);
    updateBorders(r + 1, c, maze, depth - 1, cache);
    updateBorders(r, c - 1, maze, depth - 1, cache);
    updateBorders(r, c + 1, maze, depth - 1, cache);
}
