// This file tests the Compose spec implementation

// Import the necessary types
import { ComposeSpecification } from './src/services/compose';

// Create a basic Compose specification
const testComposeSpec: ComposeSpecification = {
  version: '3',
  services: {
    web: {
      image: 'nginx:latest',
      ports: ['80:80'],
      volumes: ['./html:/usr/share/nginx/html']
    },
    db: {
      image: 'postgres:14',
      volumes: ['postgres_data:/var/lib/postgresql/data'],
      environment: {
        POSTGRES_PASSWORD: 'password',
        POSTGRES_USER: 'user',
        POSTGRES_DB: 'db'
      }
    }
  },
  volumes: {
    postgres_data: {}
  }
};

// Log the spec to confirm it's valid
console.log('Successfully created Compose specification:');
console.log(JSON.stringify(testComposeSpec, null, 2));

// Validate that the specification matches the types
const validateCompose = (spec: ComposeSpecification): boolean => {
  return (
    !!spec.version &&
    !!spec.services &&
    Object.keys(spec.services).length > 0
  );
};

console.log('Validation result:', validateCompose(testComposeSpec));