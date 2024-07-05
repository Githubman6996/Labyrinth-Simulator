const DIR_NONE = -1;
const DIR_UP = 0;
const DIR_RIGHT = 1;
const DIR_DOWN = 2;
const DIR_LEFT = 3;

const ROWS = 50;
const COLS = 50;

function getMaze() {
    return {
        maze: new Array(ROWS * COLS).fill(DIR_NONE),
    };
}

let maze = getMaze();

console.log(maze);

document.body.style.setProperty("--size", Math.min(innerHeight / (ROWS + 2), innerWidth / (COLS + 2)) + "px");
document.body.style.setProperty("--size", `min(100vh / ${ROWS + 2}, 100vw / ${COLS + 2})`);
const mazeDiv = document.querySelector("#maze");
mazeDiv.innerHTML = "";

function textDir(dir) {
    switch (dir) {
        case DIR_NONE:
            return " ";
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

const HUNT = 0;
const REST = 1;

let state = HUNT,
    huntCountdown = 1000,
    curR,
    curC,
    randR,
    randC;
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
            cell.style.borderColor = "transparent";

            cell.onpointerenter = () => {
                curR = r;
                curC = c;
                cell.style.backgroundColor = "#0080ff";
            };

            cell.onpointerleave = () => {
                cell.style.backgroundColor = "unset";
            };
        }
    }
}

class RandArr {
    arr = [0, 1, 2, 3];
    i = -1;
    next() {
        if (++this.i == this.arr.length) this.i = 0;
        const ind = Math.floor(Math.random() * (this.arr.length - this.i)) + this.i;
        let temp = this.arr[this.i];
        this.arr[this.i] = this.arr[ind];
        this.arr[ind] = temp;
        return this.arr[this.i];
    }
}

function nextPos(row, col, dir) {
    switch (dir) {
        case DIR_UP:
            return [row - 1, col];
        case DIR_RIGHT:
            return [row, col + 1];
        case DIR_DOWN:
            return [row + 1, col];
        case DIR_LEFT:
            return [row, col - 1];
    }
}

function getNextPos(maze, row, col, dir) {
    switch (dir) {
        case DIR_UP:
            return getCell(maze, row - 1, col);
        case DIR_RIGHT:
            return getCell(maze, row, col + 1);
        case DIR_DOWN:
            return getCell(maze, row + 1, col);
        case DIR_LEFT:
            return getCell(maze, row, col - 1);
    }
}

async function huntAndKill(maze, [row, col], fromDir, rand) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS || maze[row * COLS + col] != -1) {
        let ind = maze.indexOf(DIR_NONE);
        if (ind == -1) return;
        row = Math.floor(ind / COLS);
        col = ind % COLS;
        fromDir = Math.floor(Math.random() * 4);
        let cell;
        while ((cell = getNextPos(maze, row, col, fromDir)) == null || cell == -1) fromDir = Math.floor(Math.random() * 4);
        fromDir = (fromDir + 2) % 4;
    }
    mazeDiv.children[row].children[col].animate(
        [
            {
                backgroundColor: "#8000ff",
            },
            {
                backgroundColor: "black",
            },
        ],
        {
            duration: 500,
            easing: "linear",
        }
    );
    maze[row * COLS + col] = (fromDir + 2) % 4;
    updateBorders(row, col, maze, 2, {});
    await new Promise((r) => setTimeout(r, 0));
    let next = Math.floor(Math.random() * 4),
        tries = 0;
    while (++tries < 4 && getNextPos(maze, row, col, next) != -1) next = Math.floor(Math.random() * 4);
    return huntAndKill(maze, nextPos(row, col, next), next, rand);
}

await huntAndKill(maze.maze, [0, 0], [DIR_LEFT, DIR_UP][Math.floor(Math.random() * 2)], new RandArr());
console.log("Done");

function getCell(maze, r, c) {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) return maze[r * COLS + c];
}

function updateBorders(r, c, maze, depth = 2, cache = {}) {
    let cell;
    if ((depth != 2 && cache[r + " " + c]) || depth <= 0 || r < 0 || r >= ROWS || c < 0 || c >= COLS || !(cell = document.querySelector(`[data-row="${r}"][data-col="${c}"]`))) return;
    if (maze[r * COLS + c] == DIR_NONE) cell.style.borderColor = "transparent";
    else {
        cell.style.borderTopColor = maze[r * COLS + c] == 0 || getCell(maze, r - 1, c) == 2 ? "transparent" : "white";
        cell.style.borderBottomColor = maze[r * COLS + c] == 2 || getCell(maze, r + 1, c) == 0 ? "transparent" : "white";
        cell.style.borderRightColor = maze[r * COLS + c] == 1 || getCell(maze, r, c + 1) == 3 ? "transparent" : "white";
        cell.style.borderLeftColor = maze[r * COLS + c] == 3 || getCell(maze, r, c - 1) == 1 ? "transparent" : "white";
    }
    cell.firstChild.innerHTML = textDir(maze[r * COLS + c]);
    cache[r + " " + c] = true;
    updateBorders(r - 1, c, maze, depth - 1, cache);
    updateBorders(r + 1, c, maze, depth - 1, cache);
    updateBorders(r, c - 1, maze, depth - 1, cache);
    updateBorders(r, c + 1, maze, depth - 1, cache);
}
