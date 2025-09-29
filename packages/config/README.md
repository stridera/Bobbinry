# config

Configuration management package for Bobbinry.

## Purpose

This package handles configuration management across the Bobbinry platform, providing centralized configuration loading, validation, and environment-specific settings management.

## Features

- **Environment Configuration**: Development, staging, and production configs
- **Schema Validation**: Ensure configuration integrity
- **Secret Management**: Secure handling of sensitive configuration
- **Hot Reloading**: Dynamic configuration updates during development
- **Type Safety**: TypeScript interfaces for all configuration objects

## Development

### Setup

```bash
# Install dependencies
pnpm install

# No build step required (configuration files)
```

### Project Structure

```
src/
├── index.js          # Main configuration loader
├── environments/     # Environment-specific configs
│   ├── development.js
│   ├── staging.js
│   └── production.js
├── schemas/          # Configuration validation schemas
└── defaults.js       # Default configuration values
```

## Usage

### Basic Configuration Loading

```javascript
const config = require('config');

// Access configuration values
const databaseUrl = config.get('database.url');
const apiPort = config.get('api.port');
const debugMode = config.get('debug');
```

### Environment-Specific Configuration

```javascript
// development.js
module.exports = {
  database: {
    url: 'postgresql://localhost:5432/bobbinry_dev',
    ssl: false
  },
  api: {
    port: 4000,
    cors: {
      origin: 'http://localhost:3000'
    }
  },
  debug: true
};

// production.js
module.exports = {
  database: {
    url: process.env.DATABASE_URL,
    ssl: true
  },
  api: {
    port: process.env.PORT || 4000,
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || []
    }
  },
  debug: false
};
```

### Configuration Schema

```javascript
// schemas/database.js
module.exports = {
  type: 'object',
  required: ['url'],
  properties: {
    url: {
      type: 'string',
      format: 'uri'
    },
    ssl: {
      type: 'boolean',
      default: false
    },
    pool: {
      type: 'object',
      properties: {
        min: { type: 'number', minimum: 0 },
        max: { type: 'number', minimum: 1 }
      }
    }
  }
};
```

## Configuration Categories

### Database Configuration

```javascript
{
  database: {
    url: "postgresql://user:pass@host:port/dbname",
    ssl: true,
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: "./migrations",
      autoRun: false
    }
  }
}
```

### API Configuration

```javascript
{
  api: {
    port: 4000,
    host: "0.0.0.0",
    cors: {
      origin: ["https://app.bobbinry.com"],
      credentials: true
    },
    rateLimit: {
      windowMs: 900000,
      max: 100
    }
  }
}
```

### Authentication Configuration

```javascript
{
  auth: {
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: "24h"
    },
    oauth: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET
      }
    }
  }
}
```

### Storage Configuration

```javascript
{
  storage: {
    type: "s3", // or "local", "gcs"
    s3: {
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    },
    local: {
      uploadPath: "./uploads",
      maxFileSize: "10MB"
    }
  }
}
```

## Environment Variables

### Required Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/dbname

# Authentication
JWT_SECRET=your-jwt-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Storage
S3_BUCKET=your-s3-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
```

### Optional Environment Variables

```bash
# API Configuration
PORT=4000
API_HOST=0.0.0.0
ALLOWED_ORIGINS=https://app.bobbinry.com,https://staging.bobbinry.com

# Debug
DEBUG=true
LOG_LEVEL=info

# Features
ENABLE_WEBHOOKS=true
ENABLE_AI_FEATURES=false
```

## Configuration Validation

```javascript
const { validateConfig } = require('config');

// Validate current configuration
const validation = validateConfig();
if (!validation.valid) {
  console.error('Configuration errors:', validation.errors);
  process.exit(1);
}
```

## Dynamic Configuration

```javascript
const config = require('config');

// Watch for configuration changes
config.watch('api.rateLimit', (newValue, oldValue) => {
  console.log('Rate limit updated:', { oldValue, newValue });
  updateRateLimiter(newValue);
});

// Update configuration at runtime
config.set('feature.beta', true);
```

## Integration

This package is used by:
- **API Server**: For database, authentication, and service configuration
- **Shell**: For client-side configuration and feature flags
- **Compiler**: For build-time configuration
- **Scripts**: For deployment and maintenance scripts

## Configuration Management Best Practices

1. **Never commit secrets**: Use environment variables for sensitive data
2. **Validate early**: Validate configuration on application startup
3. **Use schemas**: Define schemas for all configuration objects
4. **Environment parity**: Keep development and production configs similar
5. **Document variables**: Maintain clear documentation of all config options

## Contributing

1. Add new configuration categories to appropriate environment files
2. Create validation schemas for new configuration sections
3. Update environment variable documentation
4. Test configuration changes across all environments
5. Follow the existing configuration structure patterns