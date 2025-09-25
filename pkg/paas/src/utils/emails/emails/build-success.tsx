import React from 'react';

const BuildSuccessEmail = ({ projectName, applicationName, buildLink }: any) => {
  return (
    <div>
      <h1>Build Successful!</h1>
      <p>Project: {projectName}</p>
      <p>Application: {applicationName}</p>
      <a href={buildLink}>View Build</a>
    </div>
  );
};

export default BuildSuccessEmail;