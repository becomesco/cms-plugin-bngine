import {
  Controller,
  ControllerPrototype,
  Delete,
  Get,
  HttpErrorFactory,
  JWTConfigService,
  JWTEncryptionAlg,
  Logger,
  Post,
  Put,
} from '@becomes/purple-cheetah';
import type { Request, Router } from 'express';
import type { JobLite } from './interfaces/job-lite';
import type { Job, JobFS, ProjectProtected } from './models';
import { JobRequestHandler } from './request-handlers';
import { ProjectRequestHandler } from './request-handlers/project';

JWTConfigService.add({
  id: 'user-token-config',
  alg: JWTEncryptionAlg.HMACSHA256,
  expIn: parseInt(process.env.JWT_EXP_AFTER, 10),
  issuer: process.env.JWT_ISSUER,
  secret: process.env.JWT_SECRET,
});

@Controller('/api/plugin/bngine')
export class PluginController implements ControllerPrototype {
  name = 'BngineController';
  baseUri: string;
  initRouter: any;
  logger: Logger;
  router: Router;

  @Get('/project/all')
  async getAllProjects(
    request: Request,
  ): Promise<{
    projects: ProjectProtected[];
  }> {
    return {
      projects: await ProjectRequestHandler.getAllProtected(
        request.headers.authorization,
      ),
    };
  }

  @Get('/project/:id')
  async getProjectById(
    request: Request,
  ): Promise<{
    project: ProjectProtected;
  }> {
    return {
      project: await ProjectRequestHandler.getByIdProtected(
        request.headers.authorization,
        request.params.id,
      ),
    };
  }

  @Get('/project/:projectName/branches')
  async getProjectBranches(
    request: Request,
  ): Promise<{
    branches: string[];
  }> {
    return {
      branches: await ProjectRequestHandler.getBranches(
        request.headers.authorization,
        request.params.projectName,
      ),
    };
  }

  @Get('/project/preview/previews')
  async getProjectPreviews(request: Request): Promise<{ previews: string[] }> {
    return {
      previews: await ProjectRequestHandler.getPreviews(
        request.headers.authorization,
        'preview',
      ),
    };
  }

  @Post('/project')
  async createProject(
    request: Request,
  ): Promise<{ project: ProjectProtected }> {
    return {
      project: await ProjectRequestHandler.create(
        request.headers.authorization,
        request.body,
      ),
    };
  }

  @Put('/project')
  async updateProject(
    request: Request,
  ): Promise<{ project: ProjectProtected }> {
    return {
      project: await ProjectRequestHandler.update(
        request.headers.authorization,
        request.body,
      ),
    };
  }

  @Delete('/project/:id')
  async deleteProjectById(request: Request): Promise<{ message: string }> {
    await ProjectRequestHandler.deleteById(
      request.headers.authorization,
      request.params.id,
    );
    return {
      message: 'Success.',
    };
  }

  @Delete('/project/preview/:name')
  async deleteProjectPreview(request: Request): Promise<{ message: string }> {
    await ProjectRequestHandler.deletePreview(
      request.headers.authorization,
      request.params.name,
    );
    return {
      message: 'Success.',
    };
  }

  @Get('/job/all/lite')
  async getAll(request: Request): Promise<{ jobs: JobLite[] }> {
    return {
      jobs: await JobRequestHandler.getAllLite(request.headers.authorization),
    };
  }

  @Get('/job/all/lite/:project')
  async getAllLiteByProject(request: Request): Promise<{ jobs: JobLite[] }> {
    return {
      jobs: await JobRequestHandler.getAllLiteByProject(
        request.headers.authorization,
        request.params.project,
      ),
    };
  }

  @Get('/job/lite/:id')
  async getJobLiteById(request: Request): Promise<{ job: JobLite }> {
    return {
      job: await JobRequestHandler.getLiteById(
        request.headers.authorization,
        request.params.id,
      ),
    };
  }

  @Get('/job/:id')
  async getById(request: Request): Promise<{ job: Job | JobFS }> {
    return {
      job: await JobRequestHandler.getById(
        request.headers.authorization,
        request.params.id,
      ),
    };
  }

  @Post('/job/start/:projectName')
  async start(request: Request): Promise<{ job: Job | JobFS }> {
    return {
      job: await JobRequestHandler.startJob(
        request.headers.authorization,
        request.params.projectName,
        request.body,
      ),
    };
  }
}
