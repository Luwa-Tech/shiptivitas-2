import express from 'express';
import Database from 'better-sqlite3';
import cors from 'cors'

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  return res.status(200).send({ 'message': 'SHIPTIVITY API. Read documentation to see API docs' });
});

// We are keeping one connection alive for the rest of the life application for simplicity
const db = new Database('./clients.db');

// Don't forget to close connection when server gets terminated
const closeDb = () => db.close();
process.on('SIGTERM', closeDb);
process.on('SIGINT', closeDb);

/**
 * Validate id input
 * @param {any} id
 */
const validateId = (id) => {
  if (Number.isNaN(id)) {
    return {
      valid: false,
      messageObj: {
        'message': 'Invalid id provided.',
        'long_message': 'Id can only be integer.',
      },
    };
  }
  const client = db.prepare('select * from clients where id = ? limit 1').get(id);
  if (!client) {
    return {
      valid: false,
      messageObj: {
        'message': 'Invalid id provided.',
        'long_message': 'Cannot find client with that id.',
      },
    };
  }
  return {
    valid: true,
  };
}

/**
 * Validate priority input
 * @param {any} priority
 */
const validatePriority = (priority) => {
  if (Number.isNaN(priority)) {
    return {
      valid: false,
      messageObj: {
        'message': 'Invalid priority provided.',
        'long_message': 'Priority can only be positive integer.',
      },
    };
  }
  return {
    valid: true,
  }
}

/**
 * Get all of the clients. Optional filter 'status'
 * GET /api/v1/clients?status={status} - list all clients, optional parameter status: 'backlog' | 'in-progress' | 'complete'
 */
app.get('/api/v1/clients', (req, res) => {
  const status = req.query.status;
  if (status) {
    // status can only be either 'backlog' | 'in-progress' | 'complete'
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        'message': 'Invalid status provided.',
        'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }
    const clients = db.prepare('select * from clients where status = ?').all(status);
    return res.status(200).send(clients);
  }
  const statement = db.prepare('select * from clients');
  const clients = statement.all();
  return res.status(200).send(clients);
});

/**
 * Get a client based on the id provided.
 * GET /api/v1/clients/{client_id} - get client by id
 */
app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }
  return res.status(200).send(db.prepare('select * from clients where id = ?').get(id));
});

/**
 * Update client information based on the parameters provided.
 * When status is provided, the client status will be changed - done
 * When priority is provided, the client priority will be changed with the rest of the clients accordingly
 * Note that priority = 1 means it has the highest priority (should be on top of the swimlane).
 * No client on the same status should not have the same priority.
 * This API should return list of clients on success
 *
 * PUT /api/v1/clients/{client_id} - change the status of a client
 *    Data:
 *      status (optional): 'backlog' | 'in-progress' | 'complete',
 *      priority (optional): integer,
 *
 */
app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }

  let { status, priority } = req.body;
  let clients = db.prepare('select * from clients').all();
  const client = clients.find(client => client.id === id);

  /* ---------- Update code below ----------*/
  if (!client) {
    res.status(404).json({ message: `Client with id: ${id} do not exist` });
    return;
  }

  const prevStatus = client.status;

  // If the client's status has changed, update both the previous and new statuses.
  if (status && priority && status !== prevStatus) {
    db.prepare('UPDATE clients SET priority = ?, status = ? WHERE id = ?').run(priority, status, id);

    clients = db.prepare('select * from clients').all();

    const clientsFromPrevStatus = filterClients(clients, prevStatus);

    // Reassign priority values for clients in the previous status group, ensuring no duplicates.
    clientsFromPrevStatus.forEach((client, index) => {
      db.prepare('UPDATE clients SET priority = ? WHERE id = ?').run(index + 1, client.id);
    });

    // Get a list of clients from the new status group, which includes the updated client.
    const clientsFromNewStatus = filterClients(clients, status);

    clientsFromNewStatus.forEach((client, index) => {
      db.prepare('UPDATE clients SET priority = ? WHERE id = ?').run(index + 1, client.id);
    });
  }

  if (priority && status === prevStatus) {
    db.prepare('UPDATE clients SET priority = ? WHERE id = ?').run(priority, id);
    clients = db.prepare('select * from clients').all();

    const clientsFromCurrentStatus = filterClients(clients, status);

    let updatedPriority = 1;
    clientsFromCurrentStatus.forEach((client) => {
      // Skip the client we just updated
      if (client.id !== id) {
        // If `updatedPriority` matches the target priority, skip it by increasing `updatedPriority`
        const adjustedPriority = updatedPriority === priority ? ++updatedPriority : updatedPriority;
        db.prepare('UPDATE clients SET priority = ? WHERE id = ?').run(adjustedPriority, client.id);
        // Move to the next priority value.
        updatedPriority++;
      }
    });
  }

  clients = db.prepare('select * from clients where status = ?').all(status);
  return res.status(200).send(clients.sort((a, b) => a.priority - b.priority));
})

const filterClients = (clients, status) => {
  return clients.filter(client => client.status === status).sort((a, b) => a.priority - b.priority);
};

app.listen(3001);
console.log('app running on port ', 3001);
