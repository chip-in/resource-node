import * as http from "http";

interface ServiceEngineConstructor {
    new(option?: {}): ServiceEngine;
}

export class ResourceNode {
    constructor(coreNodeURL: string, nodeClassName: string)
    fetch(path: string, option?: {}): Promise<Response>;
    mount(path: string, mode: string, proxy: Proxy, option?: object): Promise<string>;
    publish(topicName: string, message: string): Promise<void>;
    registerServiceClasses(mapping: { [key: string]: ServiceEngineConstructor }): void;
    searchServiceEngine(serviceClassName: string, query: { [key: string]: any }): ServiceEngine[];
    setBasicAuthorization(userid: string, password: string): void;
    start(): Promise<any>;
    stop(): Promise<void>;
    subscribe(topicName: string, subscriber: Subscriber): Promise<string>;
    unmount(handle: string): Promise<void>;
    unsubscribe(key: string): Promise<void>;
    setJWTAuthorization(jwt: string, updatePath: string): void;
}

export abstract class Proxy {
    constructor()
    abstract onReceive(req: http.IncomingMessage, res: http.ServerResponse): Promise<http.ServerResponse>;
}

export abstract class ServiceEngine {
    constructor(option?: {})
    abstract start(node: ResourceNode): Promise<void>;
    abstract stop(node: ResourceNode): Promise<void>;
}

export abstract class Subscriber {
    constructor()
    abstract onReceive(msg: string): void;
}
