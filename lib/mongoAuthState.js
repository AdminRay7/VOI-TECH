const { initAuthCreds, BufferJSON, proto } = require("@whiskeysockets/baileys");

async function useMongoDBAuthState(collection, sessionId) {
    const writeData = async (data, id) => {
        try {
            await collection.updateOne(
                { _id: id },
                { $set: { data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)) } },
                { upsert: true }
            );
        } catch (error) {
            console.error("Error writing session to DB:", error);
        }
    };

    const readData = async (id) => {
        try {
            const doc = await collection.findOne({ _id: id });
            if (doc && doc.data) {
                return JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            return null;
        }
    };

    const removeData = async (id) => {
        try {
            await collection.deleteOne({ _id: id });
        } catch (error) {}
    };

    const credsId = `${sessionId}:creds`;
    const creds = (await readData(credsId)) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${sessionId}:${type}-${id}`);
                            if (type === "app-state-sync-key" && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${sessionId}:${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData(creds, credsId);
        }
    };
}

module.exports = { useMongoDBAuthState };