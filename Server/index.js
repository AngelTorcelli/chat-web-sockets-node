import express from "express";
import logger from "morgan";
import { Server } from "socket.io"
import { createServer } from 'node:http'
import dotenv from 'dotenv'
import { createClient } from '@libsql/client'
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';


dotenv.config();
const port = process.env.PORT || 3000;

const app = express();
// Middleware para parsear JSON
app.use(express.json());
app.use(cookieParser());
app.use(logger('dev'));

const server = createServer(app);
const io = new Server(server,{
    // especificamos el maximo de tiempo entre reintentos
    connectionStateRecovery: {
       
    }
});


const db = createClient({
    url: process.env.DB_URL,
    authToken: process.env.DB_AUTH_TOKEN
})

await db.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT, user TEXT, date TEXT)");

await db.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT)");

io.on('connection',async (socket) => {
    console.log('a user has connected');

    //console.log(socket.handshake.auth)

    socket.on('disconnect', () => {
        console.log("a user has disconnected");
    })

    socket.on('logout', async () => {
        socket.recovered = true
        socket.handshake.auth.serverOffset = 0
        socket.disconnect()
        
    })

    socket.on('chat message', async (msg,user) => {
        
        let result;
        let date = new Date();
        date = `${date.toDateString()} - ${date.getHours().toString().padStart(2, 0)}:${date.getMinutes().toString().padStart(2, 0)}`

        //console.log("user: " + user + " date: " + date.toString() + " message: " + msg)
        try{
            result = await db.execute({
                sql: "INSERT INTO messages (message, user , date) VALUES (:msg, :user, :date)",
                args:{msg,user,date}
            });
        }catch(err){
            console.error(err);
            return
        }

        console.log("message: " + msg)
        io.emit('chat message', msg, result.lastInsertRowid.toString(),user,date) // emite a todos los clientes conectados al servidor (broadcast)
    })


    if(!socket.recovered){
        console.log("recovered")
        
        try {
            const result = await db.execute({
                sql:"SELECT id, message, user,date FROM messages WHERE id > ?", 
                args:[socket.handshake.auth.serverOffset ?? 0]
            
            });
            result.rows.forEach(row => {
                socket.emit('chat message', row.message, row.id.toString(),row.user,row.date)
                console.log(row)
            })
        } catch (error) {
            console.error(error);
        }
    }
});



app.get('/', (req,res)=>{
    res.sendFile(process.cwd()+"/Cliente/login.html");
})

app.get('/registro', (req,res)=>{
    res.sendFile(process.cwd()+"/Cliente/registro.html");
})

//logout
app.get('/logout', (req, res) => {
    res.clearCookie('access_token');
    res.redirect('/');
});

// Ruta para registrar un usuario
app.post('/registro', async (req, res) => {
    console.log(req.body);
    const { nombre, password } = req.body;

    try {
        const result = await db.execute({
            sql: "INSERT INTO users (username, password) VALUES (:nombre, :password)",
            args: { nombre, password }
        });
        res.status(200).send("Usuario registrado correctamente");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error al registrar el usuario");
    }
});


// Ruta para el inicio de sesión
app.post('/login', async (req, res) => {
    const { nombre, password } = req.body;
    let result = await db.execute({
        sql: "SELECT * FROM users WHERE username = :nombre AND password = :password",
        args: { nombre, password }
    });
    if (result.rows.length === 1) {
        const token = jwt.sign({ nombre: nombre }, 'secreto', { expiresIn: '1h' });
        res.cookie('access_token', token, { httpOnly: true }); 
        res.status(200).send({ token: token });
    } else {
        res.status(401).send({ error: 'Credenciales incorrectas' });
    }
});
const verificarToken = (req, res, next) => {
    const token = req.cookies.access_token; //obtiene el token de la cookie access_token
    console.log(token);
    if (!token) {
        return res.status(401).sendFile(process.cwd()+"/Cliente/login.html");
    }
    const { nombre } = jwt.decode(token);
    console.log("User verificado: " + nombre);
    try {
        const verified = jwt.verify(token, 'secreto');
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).sendFile(process.cwd()+"/Cliente/login.html");
        console.log(err);
    }
};

app.get('/getUserConnected', (req, res) => {
    const token = req.cookies.access_token;
    const { nombre } = jwt.decode(token);
    //console.log("User verificado al obtener usuario: " + nombre);
    res.send({ user: nombre });
});

// Ruta protegida que requiere autenticación
app.get('/mensajes', verificarToken, (req, res) => {
    res.sendFile(process.cwd()+"/Cliente/index.html");

});

// Manejador de errores para rutas no encontradas
app.use((req, res) => {
    res.status(404).sendFile(process.cwd()+"/Cliente/404.html");
    

});


server.listen(port,()=>{
    console.log(`Server running on port ${port}`);
})