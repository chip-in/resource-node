# chip-in resource-node example : static-files-server

This is a resource-node implementation example which mounts local-files on core-node.

## Getting started

1. Install docker
1. docker run -v ${PATH_OF_HTTP_ROOT}:/usr/local/chip-in/resource-node/examples/static-files-server/public/ chipin/rn-example-staticfileserver ${CORE_NODE_URL} ${NODE_CLASS}


## YAML example for static-file-server

```
name: static-file-server
serviceEngines:
- class: StaticFileServer
  path: /a/example_server/
  mode: singletonMaster

```


