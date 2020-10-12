import * as childProcess from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as uuid from 'uuid';
import { Logger, Queueable } from '@becomes/purple-cheetah';
import {
  Job,
  JobFS,
  JobPipe,
  JobStatus,
  Project,
  ProjectFS,
  ProjectVar,
} from './models';
import { JobRepo } from './repository';
import { SocketUtil } from '@becomes/cms-backend';

export class BuildEngine {
  private static logger = new Logger('BuildEngine');
  private static queueable = Queueable('start');

  static async start(
    job: Job | JobFS,
    project: Project | ProjectFS,
    vars?: ProjectVar[],
  ): Promise<void> {
    if (project) {
      project.vars.push({
        key: 'cwd',
        value: process.cwd(),
      });
      if (vars) {
        for (const i in vars) {
          let found = false;
          for (const j in project.vars) {
            if (project.vars[j].key === vars[i].key) {
              project.vars[j].value = vars[i].value;
              found = true;
              break;
            }
          }
          if (!found) {
            project.vars.push(vars[i]);
          }
        }
      }
      await this.queueable.exec('start', 'free_one_by_one', async () => {
        job.inQueueFor = Date.now() - job.createdAt;
        job.status = JobStatus.RUNNING;
        await JobRepo.update(job as Job & JobFS);
        SocketUtil.pluginEmit('bngine', {
          state: 'job-started',
          jobId: job._id,
          inQueueFor: job.inQueueFor,
        });
        if (await this.initProject(job, project)) {
          const workspace = path.join(
            process.cwd(),
            'bngine-workspace',
            project.repo.name,
          );
          for (let i = 0; i < project.run.length; i = i + 1) {
            const run = project.run[i];
            for (const j in project.vars) {
              const key = '${' + project.vars[j].key + '}';
              while (true) {
                if (run.command.indexOf(key) === -1) {
                  break;
                } else {
                  run.command = run.command.replace(key, project.vars[j].value);
                }
              }
            }
            const pipe: JobPipe = {
              id: uuid.v4(),
              title: run.title ? run.title : `Job pipe ${i + 1}`,
              cmd: `cd ${workspace} && ` + run.command,
              createdAt: Date.now(),
              err: '',
              out: '',
              ignoreIfFail: run.ignoreIfFail ? true : false,
              status: JobStatus.RUNNING,
              timeToExec: -1,
            };
            await this.runPipe(pipe, job);
            if (pipe.status === JobStatus.FAIL && pipe.ignoreIfFail === false) {
              job.status = JobStatus.FAIL;
              break;
            }
          }
        }
        job.finishedAt = Date.now();
        job.running = false;
        if (job.status !== JobStatus.FAIL) {
          job.status = JobStatus.SUCCESS;
        }
        await JobRepo.update(job as Job & JobFS);
        SocketUtil.pluginEmit('bngine', {
          state: 'done',
          jobId: job._id,
        });
      });
    } else {
      this.logger.error(
        'start',
        `Project with name "${project.name}" does not exist.`,
      );
    }
  }

  static async initProject(
    job: Job | JobFS,
    project: Project | ProjectFS,
  ): Promise<boolean> {
    if (
      (await util.promisify(fs.exists)(
        path.join(process.cwd(), 'bngine-workspace'),
      )) === false
    ) {
      await util.promisify(fs.mkdir)(
        path.join(process.cwd(), 'bngine-workspace'),
      );
    }
    if (
      (await util.promisify(fs.exists)(
        path.join(process.cwd(), 'bngine-workspace', '.ssh'),
      )) === false
    ) {
      await util.promisify(fs.mkdir)(
        path.join(process.cwd(), 'bngine-workspace', '.ssh'),
      );
    }
    // Save SSH Key
    // await fse.createFile(path.join(process.cwd(), 'workspace', '.ssh', project.repo.name));
    await util.promisify(fs.writeFile)(
      path.join(process.cwd(), 'bngine-workspace', '.ssh', project.repo.name),
      project.repo.sshKey,
    );
    // Set SSH Key permissions
    try {
      await this.exec(
        `chmod 600 ${path.join(
          process.cwd(),
          'bngine-workspace',
          '.ssh',
          project.repo.name,
        )}`,
        (type, chunk) => {
          process[type].write(chunk);
        },
      );
    } catch (error) {
      return false;
    }
    let cloned = false;
    // Initialize git repo if needed.
    if (
      (await util.promisify(fs.exists)(
        path.join(process.cwd(), 'bngine-workspace', project.repo.name),
      )) === false
    ) {
      const pip: JobPipe = {
        id: uuid.v4(),
        title: `Clone GIT repository`,
        cmd: `cd ${path.join(process.cwd(), 'bngine-workspace')} && \
        git clone ${
          project.repo.url
        } --config core.sshCommand="ssh -i ${path.join(
          process.cwd(),
          'bngine-workspace',
        )}/.ssh/${project.repo.name}"`,
        createdAt: Date.now(),
        err: '',
        out: '',
        ignoreIfFail: false,
        status: JobStatus.RUNNING,
        timeToExec: -1,
      };
      await this.runPipe(pip, job);
      if (pip.status === JobStatus.FAIL && pip.ignoreIfFail === false) {
        job.status = JobStatus.FAIL;
        return false;
      }
      cloned = true;
    }
    // Checkout to branch
    {
      const pip: JobPipe = {
        id: uuid.v4(),
        title: `Checkout to ${project.repo.branch}`,
        cmd: `cd ${path.join(
          process.cwd(),
          'bngine-workspace',
          project.repo.name,
        )} && \
        git checkout ${project.repo.branch}`,
        createdAt: Date.now(),
        err: '',
        out: '',
        ignoreIfFail: true,
        status: JobStatus.RUNNING,
        timeToExec: -1,
      };
      await this.runPipe(pip, job);
      if (pip.status === JobStatus.FAIL && pip.ignoreIfFail === false) {
        job.status = JobStatus.FAIL;
        return false;
      }
    }
    // Pull changes if required
    if (cloned === false) {
      const pip: JobPipe = {
        id: uuid.v4(),
        title: `Pull changes`,
        cmd: `cd ${path.join(
          process.cwd(),
          'bngine-workspace',
          project.repo.name,
        )} && \
        git pull`,
        createdAt: Date.now(),
        err: '',
        out: '',
        ignoreIfFail: false,
        status: JobStatus.RUNNING,
        timeToExec: -1,
      };
      await this.runPipe(pip, job);
      if (pip.status === JobStatus.FAIL && pip.ignoreIfFail === false) {
        job.status = JobStatus.FAIL;
        return false;
      }
    }
    return true;
  }

  private static async runPipe(
    pipe: JobPipe,
    job?: Job | JobFS,
  ): Promise<void> {
    if (job) {
      SocketUtil.pluginEmit('bngine', {
        state: 'new-pipe',
        jobId: job._id,
        pipe,
      });
    }
    try {
      await this.exec(pipe.cmd, (type, chunk) => {
        if (type === 'stderr') {
          pipe.err += chunk;
          if (job) {
            SocketUtil.pluginEmit('bngine', {
              state: 'pipe-update-err',
              jobId: job._id,
              pipeId: pipe.id,
              pipeCreatedAt: pipe.createdAt,
              pipeTitle: pipe.title,
              err: chunk,
            });
          }
        } else {
          pipe.out += chunk;
          if (job) {
            SocketUtil.pluginEmit('bngine', {
              state: 'pipe-update-out',
              jobId: job._id,
              pipeId: pipe.id,
              pipeCreatedAt: pipe.createdAt,
              pipeTitle: pipe.title,
              out: chunk,
            });
          }
        }
      });
      pipe.status = JobStatus.SUCCESS;
    } catch (e) {
      pipe.status = JobStatus.FAIL;
    }
    pipe.timeToExec = Date.now() - pipe.createdAt;
    job.pipe.push(pipe);
    if (job) {
      SocketUtil.pluginEmit('bngine', {
        state: 'pipe-done',
        jobId: job._id,
        pipe,
      });
    }
  }

  private static async exec(
    cmd: string,
    output: (type: 'stdout' | 'stderr', chunk: string) => void,
  ) {
    return await new Promise((resolve, reject) => {
      const proc = childProcess.exec(cmd);
      proc.stdout.on('data', (chunk) => {
        output('stdout', chunk);
      });
      proc.stderr.on('data', (chunk) => {
        output('stderr', chunk);
      });
      proc.on('close', (code) => {
        if (code !== 0) {
          reject();
        } else {
          resolve();
        }
      });
    });
  }
}
