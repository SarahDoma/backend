export const ApiPropertyOptional = (): PropertyDecorator => {
  return () => {};
};

export const ApiProperty = (): PropertyDecorator => {
  return () => {};
};

export const ApiTags = (): ClassDecorator => {
  return () => {};
};

export const ApiBearerAuth = (): MethodDecorator => {
  return () => {};
};

export const ApiOperation = (): MethodDecorator => {
  return () => {};
};

export const ApiResponse = (): MethodDecorator => {
  return () => {};
};

export const ApiQuery = (): MethodDecorator => {
  return () => {};
};

export const ApiParam = (): MethodDecorator => {
  return () => {};
};

export const ApiBody = (): MethodDecorator => {
  return () => {};
};

export const ApiExtraModels = (): ClassDecorator => {
  return () => {};
};

export const ApiHeader = (): MethodDecorator => {
  return () => {};
};

export const ApiCookieAuth = (): MethodDecorator => {
  return () => {};
};

export const ApiOAuth2 = (): MethodDecorator => {
  return () => {};
};

export const ApiSecurity = (): MethodDecorator => {
  return () => {};
};

export const ApiDeprecated = (): MethodDecorator => {
  return () => {};
};

export const ApiExcludeEndpoint = (): MethodDecorator => {
  return () => {};
};

export const ApiExcludeController = (): ClassDecorator => {
  return () => {};
};

export const SwaggerModule = {
  createDocument: jest.fn(),
  setup: jest.fn(),
};

export const DocumentBuilder = class {
  setTitle() {
    return this;
  }
  setDescription() {
    return this;
  }
  setVersion() {
    return this;
  }
  addBearerAuth() {
    return this;
  }
  addOAuth2() {
    return this;
  }
  addApiKey() {
    return this;
  }
  addCookieAuth() {
    return this;
  }
  build() {
    return {};
  }
};
