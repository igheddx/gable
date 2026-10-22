// A reader that is stuck in a busy loop and never answers: stands in for native code that stops responding.
process.on('message', () => { for (;;) { /* spin */ } });
