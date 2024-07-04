#include <emscripten.h>
#include <stdlib.h>
#include <stdio.h>
#include <stdbool.h>

#define DIR_UP 0
#define DIR_RIGHT 1
#define DIR_DOWN 2
#define DIR_LEFT 3

typedef struct OriginShift
{
    int *maze;
    int origin[2];
} real;

real *createReal(int rows, int cols)
{
    int *mazeP = malloc(sizeof(int) * rows * cols);
    real *my_maze = malloc(sizeof(real));
    my_maze->maze = mazeP;
    return my_maze;
}

EMSCRIPTEN_KEEPALIVE
real *createPerfectMaze(int rows, int cols)
{
    int dir = rand() % 4;
    real *my_struct = createReal(rows, cols);
    for (int i = 0; i < rows * cols; i++)
        my_struct->maze[i] = dir;

    switch (dir)
    {
    case DIR_UP:
        for (int i = 0; i < cols; i++)
            my_struct->maze[i] = DIR_RIGHT;
        my_struct->origin[0] = 0;
        my_struct->origin[1] = cols - 1;
        break;
    case DIR_DOWN:
        for (int i = 0; i < cols; i++)
            my_struct->maze[(rows - 1) * cols + i] = DIR_LEFT;
        my_struct->origin[0] = rows - 1;
        my_struct->origin[1] = 0;
        break;
    case DIR_LEFT:
        for (int i = 0; i < rows; i++)
            my_struct->maze[i * cols] = DIR_UP;
        my_struct->origin[0] = 0;
        my_struct->origin[1] = 0;
        break;
    case DIR_RIGHT:
        for (int i = 0; i < rows; i++)
            my_struct->maze[i * cols + cols - 1] = DIR_DOWN;
        my_struct->origin[0] = rows - 1;
        my_struct->origin[1] = cols - 1;
        break;
    }
    return my_struct;
}

bool nextPosition(int *cur, int dir, int rows, int cols)
{
    switch (dir)
    {
    case DIR_UP:
        if (cur[0] == 0)
            return false;
        break;
    case DIR_DOWN:
        if (cur[0] == rows - 1)
            return false;
        break;
    case DIR_RIGHT:
        if (cur[1] == cols - 1)
            return false;
        break;
    case DIR_LEFT:
        if (cur[1] == 0)
            return false;
        break;
    }
    return true;
}

EMSCRIPTEN_KEEPALIVE
real *shiftOrigin(real *mazeData, int rows, int cols)
{
    int new_dir = rand() % 4;
    while (!nextPosition(mazeData->origin, new_dir, rows, cols))
        new_dir = rand() % 4;
    mazeData->maze[mazeData->origin[0] * cols + mazeData->origin[1]] = new_dir;
    if (new_dir == DIR_UP)
        mazeData->origin[0]--;
    else if (new_dir == DIR_DOWN)
        mazeData->origin[0]++;
    else if (new_dir == DIR_LEFT)
        mazeData->origin[1]--;
    else if (new_dir == DIR_RIGHT)
        mazeData->origin[1]++;
    return mazeData;
}

EMSCRIPTEN_KEEPALIVE
real *createMaze(int rows, int cols)
{
    real *mazeData = createPerfectMaze(rows, cols);
    int *seenArr = malloc(sizeof(int) * rows * cols / 16 + ((rows * cols) % 16 > 0 ? 1 : 0));
    int needed = rows * cols - 1;
    while (needed > 0)
    {
        real *data = shiftOrigin(mazeData, rows, cols);
        int ind = data->origin[0] * cols + data->origin[1];
        int bit = ind % 16;
        if (((seenArr[ind / 16] >> bit) & 1) == 0)
        {
            needed--;
            seenArr[ind / 16] |= 1 << bit;
        }
    }
    free(seenArr);
    return mazeData;
}

EMSCRIPTEN_KEEPALIVE
void setSeed(unsigned int s)
{
    srand(s);
}

int main()
{
    return 0;
}