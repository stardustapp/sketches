const Future = require('fibers/future');
const yaml = require('js-yaml');
const fs = Future.wrap(require('fs'));

const {StartEnvClient} = require('../nodejs-domain-client');
Future.task(() => {
  client = StartEnvClient('software').wait()

  // baseHostname
  const config = client.loadDataStructure('/config/software').wait();
  const namespace = config.kubernetesNamespace || 'default';
  const oauth2ProxyImage = config.oauth2ProxyImage || 'dan/oauth2-proxy';

  const documents = [];

  client.listChildNames('/persist/software/containers').wait().forEach(app => {
    // image, oauthProxy, services, volumes, webPort
    const container = client.loadDataStructure('/persist/software/containers/'+app, 5).wait();
    const origin = 'stardust-architect';
    const envVars = Object.keys(container.environment).map(name => {
      const value = container.environment[name];
      return { name, value };
    });

    documents.push(yaml.dump({
      apiVersion: 'extensions/v1beta1',
      kind: 'Deployment',
      metadata: {
        labels: { app, origin },
        name: app,
        namespace,
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: { app },
        },
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: {
            maxSurge: 0,
            maxUnavailable: 1,
          },
        },
        template: {
          metadata: {
            labels: { app, origin },
          },
          spec: {
            containers: [{
              command: [
                'oauth2_proxy',
                '-upstream',
                'http://localhost:'+container.webPort,
                '-config',
                '/conf/oauth2_proxy.cfg',
                '-skip-provider-button',
              ],
              env: [{
                name: 'OAUTH2_PROXY_CLIENT_ID',
                value: container.oauthProxy.clientId,
              }, {
                name: 'OAUTH2_PROXY_CLIENT_SECRET',
                value: container.oauthProxy.clientSecret,
              }, {
                name: 'OAUTH2_PROXY_COOKIE_SECRET',
                value: container.oauthProxy.cookieSecret,
              }],
              image: oauth2ProxyImage,
              imagePullPolicy: 'Never',
              name: 'auth',
              ports: [{
                containerPort: 4180,
                name: 'authed',
                protocol: 'TCP',
              }],
              resources: {},
            }, {
              env: envVars,
              image: container.image,
              imagePullPolicy: 'Always',
              livenessProbe: {
                failureThreshold: 3,
                httpGet: {
                  path: '/',
                  port: 'app',
                  scheme: 'HTTP',
                },
                periodSeconds: 10,
                successThreshold: 1,
                timeoutSeconds: 1,
              },
              name: 'app',
              ports: [{
                containerPort: +container.webPort,
                name: 'app',
                protocol: 'TCP',
              }],
              resources: {},
              volumeMounts: Object.keys(container.volumes).map(name => {
                const mountPath = container.volumes[name].mountPath;
                return { name, mountPath };
              }),
            }],
            terminationGracePeriodSeconds: 30,
            volumes: Object.keys(container.volumes).map(name => {
              const hostPath = {
                path: container.volumes[name].hostPath,
              };
              return { name, hostPath };
            }),
          },
        },
      },
    }));

    Object.keys(container.services).map(name => {
      // type, webPort, subdomain
      const service = container.services[name];
      documents.push(yaml.dump({
        apiVersion: 'v1',
        kind: 'Service',
        metadata: {
          labels: { app, origin },
          name,
          namespace,
        },
        spec: {
          type: service.type,
          ports: [{
            name: 'http',
            port: 80,
            protocol: 'TCP',
            targetPort: service.webPort,
          }],
          selector: { app },
        },
      }));

      if (service.subdomain) {
        const hostname = service.subdomain + '.' + config.baseHostname;
        documents.push(yaml.dump({
          apiVersion: 'extensions/v1beta1',
          kind: 'Ingress',
          metadata: {
            labels: { app, origin },
            name,
            namespace,
          },
          spec: {
            rules: [{
              host: hostname,
              http: {
                paths: [{
                  backend: {
                    serviceName: name,
                    servicePort: 'http',
                  },
                  path: '/',
                }],
              },
            }],
            tls: [{
              hosts: [ hostname ],
              secretName: name + '-ssl',
            }],
          },
        }));
      }
    });

  });

  console.log('described', documents.length, 'kubernetes resources');
  const yamlFile = documents.join('---\n\n');
  fs.writeFileFuture('kubernetes-resources.yaml', yamlFile, 'utf8').wait();

  console.log('all done');
  process.exit(0);

}).detach();
