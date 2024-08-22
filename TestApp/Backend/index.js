const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

// Store room configurations
const rooms = {};

// Function to remove expired rooms
function removeExpiredRooms() {
    const now = Date.now();
    for (const roomId in rooms) {
        if (rooms[roomId].expiresAt && now > rooms[roomId].expiresAt) {
            delete rooms[roomId];
            io.to(roomId).emit('roomExpired');
            io.socketsLeave(roomId);
        }
    }
}

// Route to create a new auction room
app.get('/create-room', (req, res) => {
    const roomId = uuidv4();
    const roomSize = req.query.roomSize || 8; // Default to 8 if not provided
    const expiration = req.query.expiration || 'forever'; // Get expiration option
    const hostName = req.query.hostName; // Get host's name

    // Determine expiration time
    let expiresAt = null;
    if (expiration === '5min') {
        expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes from now
    } else if (expiration === '1min') {
        expiresAt = Date.now() + 1 * 60 * 1000; // 1 minute from now
    }

    rooms[roomId] = { roomSize: parseInt(roomSize), users: [], hostName, expiresAt };
    res.json({ roomId });
});

// Route to join an existing room
io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomId, userName }) => {
        removeExpiredRooms(); // Clean up expired rooms

        const room = rooms[roomId];

        if (!room) {
            socket.emit('roomNotFound');
            return;
        }

        if (room.users.length >= room.roomSize) {
            socket.emit('roomFull');
            return;
        }

        socket.join(roomId);
        room.users.push(userName);
        console.log(room.users);

        // Broadcast to all users in the room, including the one who just joined
        io.in(roomId).emit('userJoined', { userName });
       // io.to(roomId).emit('getUsersInRoom', room.users.map(user => ({ userName: user })));

        // Handle bidding
        socket.on('placeBid', ({ bid, player }) => {
            io.to(roomId).emit('newBid', { bid, player, userName });
        });

        // Host can kick users
        socket.on('kickUser', ({ userToKick }) => {
            if (room.hostName === userName) { // Only the host can kick users
                const userSocket = Array.from(io.sockets.sockets.values())
                    .find(s => s.rooms.has(roomId) && s.userName === userToKick);

                if (userSocket) {
                    userSocket.leave(roomId);
                    room.users = room.users.filter(user => user !== userToKick);
                    io.to(roomId).emit('userKicked', { userToKick });
                }
            } else {
                socket.emit('notAuthorized'); // Emit event if the user is not authorized to kick
            }
        });

        socket.on('getUsersInRoom', () => {
            socket.emit('currentUsers', room.users.map(user => ({ userName: user })));
        });

        // Handle disconnect
        socket.on('disconnect', () => {
            room.users = room.users.filter(user => user !== userName);
            socket.to(roomId).emit('userLeft', { userName });
        });

        // Store userName in socket for easy access
        socket.userName = userName;
    });
});

server.listen(PORT, '192.168.172.177', () => {
    console.log(`Server is running on http://192.168.172.177:${PORT}`);
});
