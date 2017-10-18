# chip-in resource-node example : one-to-one-proxy-server

This is a resource-node implementation example which forwards request to specified url.

## Getting started

1. Install docker
1. docker run chipin/rn-example-onetooneproxyserver ${CORE_NODE_URL} ${NODE_CLASS}


## YAML example for one-to-one-proxy-server

```
name: one-to-one-proxy-server-example
serviceEngines:
- class: OneToOneProxyServer
  path: /a/proxy_example/
  mode: singletonMaster
  forwardPath: http://proxy_destination


```


