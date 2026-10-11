import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';

export const app = buildApp();

export interface TestBusiness {
  token: string;
  groupCode: string;
  userId: string;
  groupId: string;
}

let counter = 0;

function uniquePhone(): string {
  return `9${Date.now().toString().slice(-5)}${String(++counter).padStart(4, '0')}`;
}

function testIp(): string {
  return `10.${Math.floor(counter / 256) % 256}.${counter % 256}.${Math.floor(Math.random() * 254) + 1}`;
}

export async function createTestAdmin(groupName?: string): Promise<TestBusiness> {
  const phone = uniquePhone();
  const res = await request(app)
    .post('/api/auth/signup')
    .set('X-Forwarded-For', testIp())
    .send({
      name: `TestAdmin${counter}`,
      phone,
      password: 'test123456',
      role: 'admin',
      groupName: groupName || `TestBiz${counter}`,
    });
  if (res.status !== 201) throw new Error(`Admin signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    token: res.body.token,
    groupCode: res.body.group.code,
    userId: res.body.user.id,
    groupId: res.body.group.id,
  };
}

export async function createTestDriver(groupCode: string): Promise<TestBusiness> {
  const phone = uniquePhone();
  const res = await request(app)
    .post('/api/auth/signup')
    .set('X-Forwarded-For', testIp())
    .send({
      name: `TestDriver${counter}`,
      phone,
      password: 'test123456',
      role: 'driver',
      groupCode,
    });
  if (res.status !== 201) throw new Error(`Driver signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    token: res.body.token,
    groupCode: res.body.group.code,
    userId: res.body.user.id,
    groupId: res.body.group.id,
  };
}

export async function cleanupGroup(groupId: string): Promise<void> {
  await prisma.group.delete({ where: { id: groupId } }).catch(() => {});
}
