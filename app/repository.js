// All writes pass through one queue so an older save cannot replace a newer one.
// Keep the last validated snapshot separately before replacing the primary file.
export function createRepository(adapter, parse, onStatus = () => {}) {
  let queue = Promise.resolve();
  let lastGood = null;
  let ready = false;
  return {
    async load() {
      const primary = await adapter.read("cookbook.json");
      if (primary !== null) {
        try {
          const data = parse(primary);
          lastGood = primary;
          ready = true;
          return { data, recovered: false };
        } catch {
          /* Try the previous complete, validated snapshot. */
        }
      }
      const previous = await adapter.read("cookbook.previous.json");
      if (previous !== null) {
        const data = parse(previous);
        lastGood = previous;
        ready = true;
        return { data, recovered: true };
      }
      if (primary !== null)
        throw new Error(
          "The saved cookbook could not be read. The original file has been kept.",
        );
      ready = true;
      return { data: null, recovered: false };
    },
    save(data) {
      if (!ready)
        return Promise.reject(new Error("Load the cookbook before saving."));
      let serialized;
      try {
        serialized = JSON.stringify(parse(JSON.stringify(data)));
      } catch (error) {
        return Promise.reject(error);
      }
      onStatus("saving");
      const operation = queue
        .catch(() => {})
        .then(async () => {
          if (lastGood !== null)
            await adapter.write("cookbook.previous.json", lastGood);
          await adapter.writeAtomic("cookbook.json", serialized);
          lastGood = serialized;
        });
      queue = operation;
      operation.then(
        () => {
          if (queue === operation) onStatus("saved");
        },
        () => onStatus("error"),
      );
      return operation;
    },
    flush() {
      return queue;
    },
  };
}
