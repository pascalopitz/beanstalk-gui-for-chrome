
import store from './store';
import events from './events';

import Queue from './beanstalk/Queue';

const INTERVAL = 1000;

class Coordinator {

	init () {
		this.query();
		this.resumeQueue();

		events.on('queue-empty', this.emptyQueue.bind(this));
		events.on('queue-details', this.getQueueDetails.bind(this));

		events.on('update-settings-start', this.pauseQueue.bind(this));
		events.on('update-settings-finish', this.resumeQueue.bind(this));
	}

	resumeQueue () {
		this.queryInterval = window.setInterval(this.query.bind(this), INTERVAL);
	}

	pauseQueue () {
		if(this.queryInterval) {
			window.clearInterval(this.queryInterval);
		}
	}

	query () {
		let client = new Queue(store.settings);

		store.stats = {};

		client.list_tubes().then((data) => {
			var all = data.map((tube) => {
				return client.stats_tube(tube);
			});

			Promise.all(all).then((data) => {
				client.disconnect();

				for(let d of data) {
					store.stats[d.name] = d;
				}
				events.emit('rerender');
			});
		});
	}


	getQueueDetails (queue) {

		store.loading = true;
		store.peek = {};
		store.job_stats = {};
		events.emit('rerender');

		let client = new Queue(store.settings);

		client.use(queue).then(() => {
			var all = [];

			all.push(client.peek_ready());
			all.push(client.peek_buried());
			all.push(client.peek_delayed());

			Promise.all(all).then((data) => {
				client.disconnect();

				store.peek.ready = data[0];
				store.peek.buried = data[1];
				store.peek.delayed = data[2];

				return data;
			}).then((data) => {

				let all = [];

				for(let d of data) {
					if(typeof d === 'object' && d.id) {
						all.push(client.stats_job(d.id));
					}
				}

				return Promise.all(all);
			}).then((data) => {

				for(let d of data) {
					store.job_stats[d.id] = d;
				}
	
				store.loading = false;
				events.emit('rerender');
			});
		});
	}


	emptyQueue (queue) {

		store.loading = true;
		events.emit('rerender');

		let client = new Queue(store.settings);

		client.watchOnly(queue).then(() => {

			let timeout;

			var emptyHandler = (job) => {
				client.deleteJob(job.id).then(reserve);
			};

			var reserve = () => {
				client.reserve().then((job) => {
					emptyHandler(job);
				}, () => {
					client.disconnect();
				});

				if(timeout) {
					clearTimeout(timeout);
				}
				timeout = setTimeout(() => {
					client.disconnect();
					store.loading = false;
					events.emit('rerender');
				}, 100);
			};

			reserve();
		});
	}
}

export default new Coordinator();