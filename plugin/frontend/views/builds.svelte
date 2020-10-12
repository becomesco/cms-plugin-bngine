<script lang="ts">
  import {
    onMount,
    beforeUpdate,
    onDestroy,
    createEventDispatcher,
  } from 'svelte';
  import {
    Button,
    StoreService,
    sdk,
    GeneralService,
  } from '@becomes/cms-ui/src';
  import { blur } from 'svelte/transition';
  import type {
    Job,
    JobModified,
    JobPipeModified,
    Project,
    JobLite,
    JobStatus,
    JobPipe,
  } from '../types';
  import {
    BnginePreviewBuildsModal,
    BngineJobInfo,
    BngineJobPipe,
    BngineJobDetailsModal,
  } from '../components';

  const dispatch = createEventDispatcher();
  export let projects: Project[];
  export let jobs: JobLite[] = [
    {
      _id: '50a7cd5d-e075-435e-b55c-65bda2a53363',
      createdAt: 1601901505310,
      updatedAt: 1601901634768,
      finishedAt: 1601901634768,
      inQueueFor: 1,
      repo: { name: 'pinkerton.com', branch: 'staging' },
      project: 'pinkerton-staging',
      running: false,
      status: 'SUCCESS' as any,
    },
  ];

  const bngineSocket = sdk.socket.subscribe(
    'plugin_bngine' as any,
    async (data: {
      jobId: string;
      state: string;
      inQueueFor?: number;
      pipe?: JobPipe;
      err?: string;
      out?: string;
      pipeCreatedAt?: number;
      pipeId?: string;
      pipeTitle?: string;
    }) => {
      if (runningJob) {
        switch (data.state) {
          case 'job-started':
            {
              runningJob.status = 'RUNNING' as JobStatus;
              runningJob.inQueueFor = data.inQueueFor;
            }
            break;
          case 'new-pipe':
            {
              runningJob.pipe = [...runningJob.pipe, parsePipe(data.pipe)];
            }
            break;
          case 'pipe-update-err':
            {
              for (const i in runningJob.pipe) {
                const pipe = runningJob.pipe[i];
                if (pipe.id === data.pipeId) {
                  runningJob.pipe[i].err += data.err;
                  break;
                }
              }
            }
            break;
          case 'pipe-update-out':
            {
              for (const i in runningJob.pipe) {
                const pipe = runningJob.pipe[i];
                if (pipe.id === data.pipeId) {
                  runningJob.pipe[i].out += data.out;
                  break;
                }
              }
            }
            break;
          case 'pipe-done':
            {
              const pipe = parsePipe(data.pipe);
              pipe.timeToExec = parseMillis(data.pipe.timeToExec);
              for (const i in runningJob.pipe) {
                if (pipe.id === runningJob.pipe[i].id) {
                  runningJob.pipe[i] = pipe;
                  break;
                }
              }
            }
            break;
          case 'done':
            {
              setTimeout(async () => {
                runningJob = undefined;
              }, 100);
              dispatch('new', data.jobId);
            }
            break;
        }
      } else {
        runningJob = parseJob(await getJobLite(data.jobId));
        if (!runningJob.pipe) {
          runningJob.pipe = [];
        }
      }
    },
  );
  let jobsModified: JobModified[];
  let jobDetails: JobModified;
  let runningJob: JobModified;
  let productionProject: Project;
  let stagingProject: Project;
  let previewProject: Project;
  let hasRunningJob: boolean = false;

  async function startJob(
    projectName: string,
    data?: {
      branch?: string;
      vars?: Array<{
        key: string;
        value: string;
      }>;
    },
  ) {
    const job = await GeneralService.errorWrapper(
      async () => {
        return await sdk.send({
          url: `/plugin/bngine/job/start/${projectName}`,
          method: 'POST',
          headers: {
            Authorization: '',
          },
          data,
        });
      },
      async (result: { job: Job }) => {
        return result.job;
      },
    );
    runningJob = job;
  }
  async function getJobLite(jobId: string): Promise<JobLite> {
    return await GeneralService.errorWrapper(
      async () => {
        return await sdk.send({
          url: `/plugin/bngine/job/lite/${jobId}`,
          method: 'GET',
          headers: {
            Authorization: '',
          },
        });
      },
      async (result: { job: JobLite }) => {
        return result.job;
      },
    );
  }

  async function setJobDetails(jobLite: JobLite) {
    const job = await GeneralService.errorWrapper(
      async () => {
        return await sdk.send({
          url: `/plugin/bngine/job/${jobLite._id}`,
          method: 'GET',
          headers: {
            Authorization: '',
          },
        });
      },
      async (result: { job: Job }) => {
        return result.job;
      },
    );
    if (job) {
      jobDetails = parseJob(job);
      StoreService.update('BngineJobDetailsModal', true);
    }
  }
  function parseJob(job: JobLite | Job): JobModified {
    const jobModified: JobModified = JSON.parse(JSON.stringify(job));
    const finishedIn = job.finishedAt - job.createdAt - job.inQueueFor;
    if (finishedIn < 0) {
      jobModified.time = 'In progress';
    } else {
      jobModified.time = parseMillis(finishedIn);
    }
    if ((job as Job).pipe) {
      jobModified.pipe = (job as Job).pipe.map((pipe) => {
        return parsePipe(pipe);
      });
    }
    return jobModified;
  }
  function parsePipe(pipe: JobPipe): JobPipeModified {
    const pipeModifed: JobPipeModified = JSON.parse(JSON.stringify(pipe));
    pipeModifed.show = false;
    pipeModifed.timeToExec = parseMillis(pipe.timeToExec);
    return pipeModifed;
  }
  function parseMillis(millis: number): string {
    if (millis > 60000) {
      return `${parseInt('' + millis / 1000 / 60)}m ${
        parseInt('' + millis / 1000) - parseInt('' + millis / 1000 / 60) * 60
      }s`;
    } else {
      return `${parseInt(`${millis / 1000}`, 10)}s`;
    }
  }

  const timeInterval = setInterval(() => {
    try {
      if (runningJob) {
        runningJob.time = parseMillis(Date.now() - runningJob.createdAt);
        if (runningJob.pipe.length > 0) {
          runningJob.pipe[runningJob.pipe.length - 1].timeToExec = parseMillis(
            Date.now() - runningJob.pipe[runningJob.pipe.length - 1].createdAt,
          );
        }
      }
    } catch (error) {
      // ignore
    }
  }, 1000);
  beforeUpdate(() => {
    if (projects) {
      productionProject = projects.find((e) => e.name === 'production');
      stagingProject = projects.find((e) => e.name === 'staging');
      previewProject = projects.find((e) => e.name === 'preview');
    }
    if (jobs) {
      const runningJob = jobs.find((e) => e.status === 'RUNNING');
      if (runningJob) {
        hasRunningJob = true;
      } else {
        hasRunningJob = false;
      }
      jobsModified = jobs
        .filter((e) => e.status !== 'RUNNING')
        .map((job) => parseJob(job));
    }
  });
  onMount(async () => {
    if (!runningJob) {
      const currentlyRunningJob = jobsModified.find(
        (e) => e.status === 'RUNNING',
      );
      if (currentlyRunningJob) {
        const j = await GeneralService.errorWrapper(
          async () => {
            return sdk.send({
              url: `/plugin/bngine/job/${currentlyRunningJob._id}`,
              method: 'GET',
              headers: {
                Authorization: '',
              },
            });
          },
          async (result: { job: Job }) => {
            return result.job;
          },
        );
        currentlyRunningJob.pipe = j.pipe;
        runningJob = currentlyRunningJob;
      }
    }
  });
  onDestroy(() => {
    bngineSocket.unsubscribe();
    clearInterval(timeInterval);
  });
</script>

<style global lang="scss">
  @import '../styles/main.scss';
</style>

<div class="bngine--builds">
  <h3>Builds</h3>
  {#if projects && jobsModified}
    <div class="bngine--builds-top">
      {#if stagingProject && stagingProject.run.length > 0}
        <Button
          disabled={runningJob ? true : false || hasRunningJob}
          on:click={() => {
            startJob(stagingProject.name);
          }}>
          Staging
        </Button>
      {/if}
      {#if productionProject && productionProject.run.length > 0}
        <Button
          class="ml--auto"
          kind="secondary"
          disabled={runningJob ? true : false || hasRunningJob}
          on:click={() => {
            startJob(productionProject.name);
          }}>
          Production
        </Button>
      {/if}
      {#if previewProject && previewProject.run.length > 0}
        <Button
          class="ml--20"
          kind="ghost"
          disabled={runningJob ? true : false || hasRunningJob}
          on:click={() => {
            StoreService.update('BnginePreviewBuildsModal', true);
          }}>
          Previews
        </Button>
      {/if}
    </div>
    {#if runningJob !== undefined}
      <div class="bngine--builds-running-job">
        <h4 class="bngine--builds-jobs-title">Running Job</h4>
        <div class="mt-20 build--running-job">
          <BngineJobInfo job={runningJob} disableDetails={true} />
          <BngineJobPipe jobPipe={runningJob.pipe} />
        </div>
      </div>
    {/if}
    <div class="bngine--builds-jobs">
      {#if jobsModified.length === 0}
        <div class="bngine--builds-jobs-none">
          There are no active or logged Jobs.
        </div>
      {:else}
        <h4 class="bngine--builds-jobs-title">Completed Jobs</h4>
        <table in:blur={{ delay: 400 }}>
          <thead>
            <tr>
              <th />
              <th>Status</th>
              <th>Duration</th>
              <th>Branch</th>
              <th>Project</th>
              <th>Date</th>
              <th>Time</th>
              <th class="details" />
            </tr>
          </thead>
          <tbody>
            {#each jobsModified as job, i}
              <tr>
                <td class="number">{jobsModified.length - i}.</td>
                <td class="status status-{job.status.toLowerCase()}">
                  {job.status}
                </td>
                <td>{jobsModified[i].time}</td>
                <td><i>{job.repo.branch}</i></td>
                <td>{job.project}</td>
                <td>{new Date(job.createdAt).toLocaleDateString()}</td>
                <td>{new Date(job.createdAt).toLocaleTimeString()}</td>
                <td>
                  <Button
                    kind="ghost"
                    icon="fas fa-eye"
                    onlyIcon={true}
                    on:click={async () => {
                      setJobDetails(job);
                    }} />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>
<BnginePreviewBuildsModal
  on:done={(event) => {
    startJob('preview', {
      branch: event.detail.branch,
      vars: [
        {
          key: 'id',
          value: event.detail.branch,
        },
      ],
    });
  }} />
<BngineJobDetailsModal
  job={jobDetails}
  on:cancel={() => {
    jobDetails = undefined;
  }}
  on:done={() => {
    jobDetails = undefined;
  }} />
