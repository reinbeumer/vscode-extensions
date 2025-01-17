/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { getJavaHome, findExecutable } from "./utils";

const MICRONAUT: string = 'Micronaut';
const NATIVE_IMAGE: string = 'native-image';

interface Goals {
    build: vscode.QuickPickItem[];
    deploy: vscode.QuickPickItem[];
}
let goals: Goals;

export async function builderInit() {
    goals = await buildWrapper(getAvailableGradleGoals, getAvailableMavenGoals) || { build: [], deploy: [] };
}

export async function build(goal?: string, group?: string) {
    group = group || 'build';
    const items: vscode.QuickPickItem[] = goals[group as keyof Goals];
    if (!goal) {
        if (items.length === 0) {
            goal = 'build';
        } else {
            const selected = items.length > 1 ? await vscode.window.showQuickPick(items, { placeHolder: `Select ${group} goal to invoke` }) : items.length === 1 ? items[0] : undefined;
            if (selected) {
                goal = selected.label;
            }
        }
    }
    if (goal) {
        const javaHome = getJavaHome();
        if (javaHome && (goal === 'nativeImage' || goal === 'dockerBuildNative')) {
            const nativeImage = findExecutable(NATIVE_IMAGE, javaHome);
            if (!nativeImage) {
                const gu = findExecutable('gu', javaHome);
                if (gu) {
                    const selected = await vscode.window.showInformationMessage(`${NATIVE_IMAGE} is not installed in your GraalVM`, `Install ${NATIVE_IMAGE}`);
                    if (selected === `Install ${NATIVE_IMAGE}`) {
                        await vscode.commands.executeCommand('extension.graalvm.installGraalVMComponent', NATIVE_IMAGE, javaHome);
                        return;
                    }
                } else {
                    vscode.window.showWarningMessage(`native-image is missing in ${javaHome}`);
                }
            }
        }
        const command = await terminalCommandFor(goal);
        if (command) {
            let terminal: vscode.Terminal | undefined = vscode.window.terminals.find(terminal => terminal.name === MICRONAUT);
            if (terminal) {
                terminal.dispose();
            }
            const env: any = {};
            if (javaHome) {
                env.JAVA_HOME = javaHome;
                env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH}`;
            }
            terminal = vscode.window.createTerminal({ name: MICRONAUT, env });
            terminal.show();
            terminal.sendText(command);
        } else {
            throw new Error(`No terminal command for ${goal}`);
        }
    }
}

async function buildWrapper<T>(gradle?: (wrapper: vscode.Uri, ...args: any[]) => T, maven?: (wrapper: vscode.Uri, ...args: any[]) => T, ...args: any[]): Promise<T | undefined> {
    let wrapper: vscode.Uri[] = await vscode.workspace.findFiles(process.platform === 'win32' ? '**/gradlew.bat' : '**/gradlew', '**/node_modules/**');
    if (gradle && wrapper && wrapper.length > 0) {
        return gradle(wrapper[0], ...args);
    }
    wrapper = await vscode.workspace.findFiles(process.platform === 'win32' ? '**/mvnw.bat' : '**/mvnw', '**/node_modules/**');
    if (maven && wrapper && wrapper.length > 0) {
        return maven(wrapper[0], ...args);
    }
    return undefined;
}

async function terminalCommandFor(goal: string): Promise<string | undefined> {
    return buildWrapper(terminalGradleCommandFor, terminalMavenCommandFor, goal);
}

function terminalGradleCommandFor(wrapper: vscode.Uri, goal: string): string | undefined {
    const exec = wrapper.fsPath.replace(/(\s+)/g, '\\$1');
    if (exec) {
        return `${exec} ${goal} --no-daemon`;
    }
    return undefined;
}

function terminalMavenCommandFor(wrapper: vscode.Uri, goal: string): string | undefined {
    const exec = wrapper.fsPath.replace(/(\s+)/g, '\\$1');
    if (exec) {
        let command;
        switch(goal) {
            case 'build':
                command = 'compile';
                break;
            case 'nativeImage':
                command = 'package -Dpackaging=native-image';
                break;
            case 'dockerBuild':
                command = 'package -Dpackaging=docker';
                break;
            case 'dockerBuildNative':
                command = 'package -Dpackaging=docker-native';
                break;
            case 'dockerPush':
                command = 'deploy -Dpackaging=docker';
                break;
            case 'dockerPushNative':
                command = 'deploy -Dpackaging=docker-native';
                break;
            default:
                command = goal;
                break;
        }
        if (command) {
            return `${exec} ${command}`;
        }
    }
    return undefined;
}

function getAvailableGradleGoals(wrapper: vscode.Uri): Goals {
    const out = cp.execFileSync(wrapper.fsPath, ['tasks', '--no-daemon', `--project-dir=${path.dirname(wrapper.fsPath)}`]);
    const buildGoals: vscode.QuickPickItem[] = parseAvailableGradleGoals(out.toString(), 'Build tasks');
    const deployGoals: vscode.QuickPickItem[] = parseAvailableGradleGoals(out.toString(), 'Upload tasks');
    return { build: buildGoals, deploy: deployGoals };
}

function parseAvailableGradleGoals(out: string, category: string): vscode.QuickPickItem[] {
    const goals: vscode.QuickPickItem[] = [];
    let process: boolean = false;
    out.toString().split('\n').map(line => line.trim()).forEach(line => {
        if (process) {
            if (line.length === 0) {
                process = false;
            }
            if (!line.startsWith('---')) {
                const info: string[] | null = line.match(/(\S+)\s*-\s*(.*)/);
                if (info && info.length >= 3) {
                    goals.push({ label: info[1], detail: info[2] });
                }
            }
        } else {
            if (line === category) {
                process = true;
            }
        }
    });
    return goals;
}

function getAvailableMavenGoals(): Goals {
    const buildGoals: vscode.QuickPickItem[] = [
        { label: 'clean', detail: 'Cleans the project' },
        { label: 'compile', detail: 'Compiles the source code of the project' },
        { label: 'package', detail: 'Packages the compiled code in its distributable format' },
        { label: 'nativeImage', detail: 'Packages the compiled code as a GraalVM native image'},
        { label: 'dockerBuild', detail: 'Builds a Docker image with the application artifacts'},
        { label: 'dockerBuildNative', detail: 'Builds a Docker image with a GraalVM native image inside'}
    ];
    const deployGoals: vscode.QuickPickItem[] = [
        { label: 'dockerPush', detail: 'Pushes a Docker Image' },
        { label: 'dockerPushNative', detail: 'Pushes a Native Docker Image using GraalVM' }
    ];
    return { build: buildGoals, deploy: deployGoals };
}
