// Component exports
export const Button = ({ children, ...props }: any) => {
  return <button {...props}>{children}</button>;
};

export const Card = ({ children, ...props }: any) => {
  return <div className="card" {...props}>{children}</div>;
};
