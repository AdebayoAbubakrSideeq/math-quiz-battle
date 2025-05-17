const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const compression = require('compression');
const dotenv = require('dotenv');
dotenv.config();


const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' }, compression: true });

app.use(compression());
app.use(express.static('public'));

const players = new Map();
const singlePlayerGames = new Map();
let leaderboard = []; // Store top scores: { username, score, difficulty, timestamp }
let currentQuestion = {};
let questionTimer = null;
let questionCount = 0;
let gameDifficulty = null;
const maxQuestions = 10;
const answersReceived = new Set();

function updateLeaderboard(username, score, difficulty) {
    try {
        leaderboard.push({ username, score, difficulty, timestamp: Date.now() });
        leaderboard.sort((a, b) => b.score - a.score || a.timestamp - b.timestamp);
        leaderboard = leaderboard.slice(0, 5); // Keep top 5
        console.log('Leaderboard updated:', leaderboard);
    } catch (error) {
        console.error('Error updating leaderboard:', error);
    }
}

function generateQuestion(questionNumber, level) {
    try {
        let num1, num2, correctAnswer, question;
        const questionTypes = level === 'Easy' ? ['arithmetic', 'geometry', 'numberTheory'] :
                             level === 'Medium' ? ['exponent', 'division', 'trigonometry', 'probability'] :
                             ['linear', 'quadratic', 'geometry', 'combinatorics'];
        const type = questionTypes[Math.floor(Math.random() * questionTypes.length)];

        if (level === 'Easy') {
            if (type === 'arithmetic') {
                const operations = ['+', '−', '×', '÷'];
                const op = operations[Math.floor(Math.random() * 4)];
                num1 = Math.floor(Math.random() * 50) + 1;
                num2 = Math.floor(Math.random() * 50) + 1;
                switch(op) {
                    case '+': correctAnswer = num1 + num2; break;
                    case '−': correctAnswer = num1 - num2; break;
                    case '×': correctAnswer = num1 * num2; break;
                    case '÷': 
                        correctAnswer = num1;
                        num2 = Math.floor(Math.random() * 10) + 1;
                        num1 = num1 * num2;
                        break;
                }
                question = `What is ${num1} ${op} ${num2}?`;
            } else if (type === 'geometry') {
                const l = Math.floor(Math.random() * 10) + 1;
                const w = Math.floor(Math.random() * 10) + 1;
                correctAnswer = l * w;
                question = `What is the area of a rectangle with length ${l} and width ${w}?`;
            } else {
                const n = Math.floor(Math.random() * 10) + 2;
                correctAnswer = n * (Math.floor(Math.random() * 5) + 3);
                question = `What is the smallest multiple of ${n} greater than ${correctAnswer - n}?`;
            }
        } else if (level === 'Medium') {
            if (type === 'exponent') {
                num1 = Math.floor(Math.random() * 10) + 1;
                num2 = Math.floor(Math.random() * 3) + 2;
                correctAnswer = Math.pow(num1, num2);
                question = `What is ${num1}^${num2}?`;
            } else if (type === 'division') {
                num1 = Math.floor(Math.random() * 20) + 1;
                num2 = Math.floor(Math.random() * 10) + 1;
                correctAnswer = num1 / num2;
                question = `What is ${num1} ÷ ${num2}? (Round to 2 decimal places)`;
                correctAnswer = Math.round(correctAnswer * 100) / 100;
            } else if (type === 'trigonometry') {
                const angles = [0, 30, 45, 90];
                const angle = angles[Math.floor(Math.random() * angles.length)];
                correctAnswer = angle === 0 ? 0 : angle === 30 ? 0.5 : angle === 45 ? 0.71 : 1;
                correctAnswer = Math.round(correctAnswer * 100) / 100;
                question = `What is sin(${angle}°)? (Round to 2 decimal places)`;
            } else {
                correctAnswer = 0.5;
                question = `What is the probability of getting heads in one coin toss?`;
            }
        } else {
            if (type === 'linear') {
                const a = Math.floor(Math.random() * 5) + 1;
                const b = Math.floor(Math.random() * 20) + 1;
                const x = Math.floor(Math.random() * 10) + 1;
                correctAnswer = x;
                const c = a * x + b;
                question = `Solve for x: ${a}x + ${b} = ${c}`;
            } else if (type === 'quadratic') {
                const root = Math.floor(Math.random() * 10) + 1;
                correctAnswer = root;
                question = `Solve for x: x² - ${root * root} = 0`;
            } else if (type === 'geometry') {
                const a = Math.floor(Math.random() * 5) + 3;
                const b = Math.floor(Math.random() * 5) + 3;
                correctAnswer = Math.sqrt(a * a + b * b);
                correctAnswer = Math.round(correctAnswer * 100) / 100;
                question = `What is the hypotenuse of a right triangle with legs ${a} and ${b}? (Round to 2 decimals)`;
            } else {
                const n = Math.floor(Math.random() * 3) + 2;
                correctAnswer = factorial(n);
                question = `How many ways can ${n} books be arranged on a shelf?`;
            }
        }

        const answers = [correctAnswer];
        while (answers.length < 4) {
            let wrong;
            if (typeof correctAnswer === 'number' && correctAnswer % 1 !== 0) {
                wrong = correctAnswer + (Math.round((Math.random() * 10 - 5) * 100) / 100);
            } else {
                wrong = correctAnswer + (Math.floor(Math.random() * 10) - 5);
            }
            if (!answers.includes(wrong) && wrong !== correctAnswer && wrong >= 0) {
                answers.push(wrong);
            }
        }
        shuffleArray(answers);

        const questionData = {
            question,
            answers,
            correct: answers.indexOf(correctAnswer),
            level,
            questionNumber
        };
        console.log('Generated question:', questionData);
        return questionData;
    } catch (error) {
        console.error('Error generating question:', error);
        return generateQuestion(questionNumber, level);
    }
}

function factorial(n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function startQuestionTimer(socket, isSinglePlayer, playerId) {
    const timeLimit = gameDifficulty === 'Easy' ? 10 : gameDifficulty === 'Medium' ? 15 : 20;
    let timeLeft = timeLimit;
    questionTimer = setInterval(() => {
        socket.emit('updateTimer', timeLeft);
        timeLeft -= 0.5;
        if (timeLeft <= 0) {
            clearInterval(questionTimer);
            questionTimer = null;
            if (isSinglePlayer) {
                nextSinglePlayerQuestion(playerId);
            } else {
                nextQuestion();
            }
        }
    }, 500);
}

function nextQuestion() {
    questionCount++;
    answersReceived.clear();
    if (questionCount > maxQuestions) {
        const playersArray = Array.from(players.values());
        if (playersArray.length === 0) return;
        const winner = playersArray.reduce((max, p) => p.score > max.score ? p : max, playersArray[0]);
        playersArray.forEach(player => {
            updateLeaderboard(player.username, player.score, gameDifficulty);
        });
        io.emit('gameOver', { winner, players: playersArray, leaderboard });
        players.clear();
        questionCount = 0;
        gameDifficulty = null;
        return;
    }

    currentQuestion = generateQuestion(questionCount, gameDifficulty);
    io.emit('newQuestion', currentQuestion);
    startQuestionTimer(io, false);
}

function nextSinglePlayerQuestion(playerId) {
    const game = singlePlayerGames.get(playerId);
    if (!game) return;
    game.questionCount++;
    if (game.questionCount > maxQuestions) {
        const socket = io.sockets.sockets.get(playerId);
        if (socket) {
            updateLeaderboard(game.username, game.score, game.difficulty);
            socket.emit('gameOver', { score: game.score, leaderboard });
        }
        singlePlayerGames.delete(playerId);
        return;
    }

    const question = generateQuestion(game.questionCount, game.difficulty);
    game.currentQuestion = question;
    singlePlayerGames.set(playerId, game);
    const socket = io.sockets.sockets.get(playerId);
    if (socket) {
        socket.emit('newQuestion', question);
        startQuestionTimer(socket, true, playerId);
    }
}

io.on('connection', (socket) => {
    socket.on('join', ({ username, difficulty, mode }) => {
        if (typeof username !== 'string' || !username.trim()) {
            console.log('Invalid username');
            return;
        }
        if (!['Easy', 'Medium', 'Hard'].includes(difficulty)) {
            console.log(`Invalid difficulty from ${username}: ${difficulty}`);
            return;
        }
        if (!['single', 'multi'].includes(mode)) {
            console.log(`Invalid mode from ${username}: ${mode}`);
            return;
        }

        if (mode === 'single') {
            singlePlayerGames.set(socket.id, {
                username: username.trim(),
                score: 0,
                difficulty,
                questionCount: 0,
                currentQuestion: null
            });
            nextSinglePlayerQuestion(socket.id);
            console.log(`Single player joined: ${username}, socket.id: ${socket.id}, Difficulty: ${difficulty}`);
        } else {
            players.set(socket.id, { id: socket.id, username: username.trim(), score: 0 });
            if (gameDifficulty === null) {
                gameDifficulty = difficulty;
                io.emit('difficultySet', gameDifficulty);
                console.log(`Difficulty set to ${gameDifficulty} by ${username}`);
            }
            console.log(`Multiplayer joined: ${username}, socket.id: ${socket.id}, Difficulty: ${gameDifficulty}`);
            if (players.size === 1) {
                nextQuestion();
            }
        }
    });

    socket.on('answer', (answerIndex) => {
        try {
            if (singlePlayerGames.has(socket.id)) {
                const game = singlePlayerGames.get(socket.id);
                if (!game) {
                    socket.emit('answerFeedback', false);
                    return;
                }
                if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= game.currentQuestion.answers.length) {
                    console.log(`Invalid answerIndex from single player ${game.username}: ${answerIndex}`);
                    socket.emit('answerFeedback', false);
                    return;
                }
                const correct = answerIndex === game.currentQuestion.correct;
                if (correct) {
                    game.score += game.difficulty === 'Easy' ? 10 : game.difficulty === 'Medium' ? 15 : 20;
                }
                socket.emit('answerFeedback', correct);
                console.log(`Single player answer from ${game.username}: ${answerIndex}, Correct: ${correct}, Score: ${game.score}`);
                if (questionTimer) {
                    clearInterval(questionTimer);
                    questionTimer = null;
                }
                nextSinglePlayerQuestion(socket.id);
            } else {
                const player = players.get(socket.id);
                if (!player) {
                    console.log(`Player with socket.id ${socket.id} not found`);
                    socket.emit('answerFeedback', false);
                    return;
                }
                if (answersReceived.has(socket.id)) {
                    console.log(`Duplicate answer from ${player.username}`);
                    return;
                }
                if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= currentQuestion.answers.length) {
                    console.log(`Invalid answerIndex from ${player.username}: ${answerIndex}`);
                    socket.emit('answerFeedback', false);
                    return;
                }
                answersReceived.add(socket.id);

                const correct = answerIndex === currentQuestion.correct;
                if (correct) {
                    player.score += currentQuestion.level === 'Easy' ? 10 : currentQuestion.level === 'Medium' ? 15 : 20;
                }
                socket.emit('answerFeedback', correct);
                console.log(`Multiplayer answer from ${player.username}: ${answerIndex}, Correct: ${correct}, Score: ${player.score}`);

                if (answersReceived.size === players.size) {
                    if (questionTimer) {
                        clearInterval(questionTimer);
                        questionTimer = null;
                    }
                    nextQuestion();
                }
            }
        } catch (error) {
            console.error('Error in answer handler:', error);
            socket.emit('answerFeedback', false);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected, socket.id: ${socket.id}`);
        if (singlePlayerGames.has(socket.id)) {
            singlePlayerGames.delete(socket.id);
        } else {
            players.delete(socket.id);
            answersReceived.delete(socket.id);
            if (players.size === 0) {
                if (questionTimer) {
                    clearInterval(questionTimer);
                    questionTimer = null;
                }
                questionCount = 0;
                gameDifficulty = null;
            }
        }
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});