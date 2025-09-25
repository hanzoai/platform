import React from 'react';

const BuildFailedEmail = ({ projectName, applicationName, errorMessage, buildLink }: any) => {
  return (
    <div>
      <h1>Build Failed</h1>
      <p>Project: {projectName}</p>
      <p>Application: {applicationName}</p>
      <p>Error: {errorMessage}</p>
      <a href={buildLink}>View Build</a>
    </div>
  );
};

export default BuildFailedEmail;
