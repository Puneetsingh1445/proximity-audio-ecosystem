
const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:5000";

const clientA = io(SERVER_URL);
const clientB = io(SERVER_URL);

let joined = 0;

function joinOffice(client, name) {
  client.emit("join-office", "test-office", (response) => {
    console.log(`${name} join response:`, response);
    joined++;

    if (joined === 2) {
      clientA.emit("move-avatar", { x: 120, y: 80 });
    }
  });
}

clientA.on("connect", () => {
  console.log("Client A connected:", clientA.id);
  joinOffice(clientA, "Client A");
});

clientB.on("connect", () => {
  console.log("Client B connected:", clientB.id);
  joinOffice(clientB, "Client B");
});

clientB.on("user-moved", (position) => {
  console.log("Client B received movement:", position);

  if (position.x === 120 && position.y === 80) {
    console.log("SUCCESS: Movement broadcast works.");
  }

  clientA.disconnect();
  clientB.disconnect();
  process.exit(0);
});

setTimeout(() => {
  console.error("Test timed out. Check that the server is running.");
  clientA.disconnect();
  clientB.disconnect();
  process.exit(1);
}, 10000);
