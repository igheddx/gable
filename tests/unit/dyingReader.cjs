// A reader that crashes as soon as it is given work.
process.on('message', () => process.exit(1));
