class SyncQueue {
    constructor(callback, onerror) {
        let self=this;
        self.queue = [];
        self.callback = callback;
        self.onerror = onerror;
        self.busy = false;
    }

    pump() {
        let self=this;
        if(self.busy) return;
        let task = self.queue.shift();
        if(task !== undefined) {
            self.busy = true;
            self.callback(task).then(() => {
                self.busy = false;
                self.pump();
            }).catch((e) => {
                if(self.onerror !== undefined) {
                    self.onerror(e);
                } else {
                    console.log("Uncaught exception: %s", e.toString);
                }
            });
        }
    }

    push(task) {
        let self=this;
        self.queue.push(task);
        self.pump();
    }
}

module.exports = SyncQueue;
